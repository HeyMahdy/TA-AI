import json
import io
import asyncio
import os
import time
from typing import List, Dict, Any

import pypdf
from psycopg2.extras import execute_values
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_text_splitters import RecursiveCharacterTextSplitter
import pymupdf4llm

from config.db import get_db_connection
from .prompts import ENTITY_EXTRACTION_PROMPT, RELATIONSHIP_EXTRACTION_PROMPT

# LLMs
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")
json_llm = llm.bind(response_format={"type": "json_object"})

ENTITY_EXTRACTION_CONCURRENCY = int(os.getenv("GRAPHRAG_ENTITY_CONCURRENCY", "4"))

# Text splitter — larger chunks = fewer LLM calls = faster processing
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=4000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " "]
)


class StageTimer:
    def __init__(self, stage: str):
        self.stage = stage
        self.start = 0.0

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb):
        elapsed = time.perf_counter() - self.start
        print(f"[GraphRAG][timing] {self.stage}: {elapsed:.2f}s")


import base64
import pymupdf
import pymupdf4llm
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

TEXT_THRESHOLD = 40  # chars — below this, a page is treated as "screenshot-only"
VISION_PROMPT = (
    "Describe this slide in detail: what boxes/shapes or diagrams it shows, "
    "how they connect, and any labeled values, numbers, or table contents."
)

# Instantiate once (outside the request function) — reused across calls
_vision_model = ChatOpenAI(model="gpt-4o", max_tokens=500)


def _describe_page_with_vision(doc: "pymupdf.Document", page_index: int) -> str:
    """Render a single page to a PNG in memory and ask the vision model to describe it."""
    pix = doc[page_index].get_pixmap(dpi=200)
    img_bytes = pix.tobytes("png")
    b64_image = base64.b64encode(img_bytes).decode("utf-8")

    message = HumanMessage(
        content=[
            {"type": "text", "text": VISION_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_image}"}},
        ]
    )
    response = _vision_model.invoke([message])
    return response.content


def extract_text_from_file(contents: bytes, content_type: str) -> list[dict]:
    """
    Returns a list of {"page": int, "text": str, "source": "pymupdf4llm" | "vision_model"}
    ready to chunk/embed downstream.
    """
    if content_type != "application/pdf":
        raise ValueError(f"Unsupported content type: {content_type}")

    doc = pymupdf.open(stream=contents, filetype="pdf")

    try:
        # STEP 1 — raw pymupdf4llm pass across the whole doc (cheap, local, fast)
        pages = pymupdf4llm.to_markdown(
            doc,
            page_chunks=True,
            embed_images=True,          # base64-embedded, no disk writes — safe for concurrent uploads
            dpi=200,
            table_strategy="lines_strict",
            header=False,
            footer=False,
            use_ocr=True,
        )

        # STEP 2 — flag pages with little/no real embedded text
        flagged_pages = {
            i for i in range(doc.page_count)
            if len(doc[i].get_text().strip()) < TEXT_THRESHOLD
        }

        # STEP 3 — route ONLY flagged pages through the vision model
        results = []
        for i, page_chunk in enumerate(pages):
            if i in flagged_pages:
                description = _describe_page_with_vision(doc, i)
                results.append({"page": i, "text": description, "source": "vision_model"})
            else:
                results.append({"page": i, "text": page_chunk["text"], "source": "pymupdf4llm"})

        return results
    finally:
        doc.close()  # always close, even if something above raises
   


def chunk_text(text: str) -> List[str]:
    """Split text into overlapping chunks."""
    return text_splitter.split_text(text)


async def extract_entities(chunks: List[str]) -> List[Dict[str, Any]]:
    """Use LLM to extract entities from each chunk, then deduplicate."""
    all_entities = {}
    semaphore = asyncio.Semaphore(ENTITY_EXTRACTION_CONCURRENCY)

    async def extract_chunk_entities(chunk: str) -> List[Dict[str, Any]]:
        messages = [
            SystemMessage(content=ENTITY_EXTRACTION_PROMPT),
            HumanMessage(content=f"Syllabus chunk:\n\n{chunk}")
        ]

        async with semaphore:
            response = await json_llm.ainvoke(messages)

        try:
            parsed = json.loads(response.content)
            return parsed.get("entities", [])
        except (json.JSONDecodeError, KeyError) as e:
            print(f"[extract_entities] JSON parse error: {e}")
            return []

    chunk_results = await asyncio.gather(
        *(extract_chunk_entities(chunk) for chunk in chunks),
        return_exceptions=True
    )

    for result in chunk_results:
        if isinstance(result, Exception):
            print(f"[extract_entities] Chunk extraction error: {result}")
            continue

        for entity in result:
            name = entity.get("name", "").strip().lower()
            if name and name not in all_entities:
                all_entities[name] = entity

    return list(all_entities.values())


async def extract_relationships(entities: List[Dict]) -> List[Dict[str, Any]]:
    """Use LLM to extract relationships between entities."""
    if len(entities) < 2:
        return []

    # Format entities for the prompt
    entity_names = [e["name"] for e in entities]
    entities_json = json.dumps(
        [{"name": e["name"], "type": e.get("type", "topic"), "description": e.get("description", ""),
          "week_or_unit": e.get("week_or_unit", "Unknown"),
          "difficulty_level": e.get("difficulty_level", "Unknown")}
         for e in entities],
        indent=2
    )

    system_content = f"""You are an academic curriculum analyst. Given these academic entities extracted from a syllabus, identify relationships between them.

ENTITIES:
{entities_json}

For each relationship, output a JSON object with:
- source: The name of the source entity (must match exactly from the list above)
- target: The name of the target entity (must match exactly from the list above)
- relationship_type: One of "PREREQUISITE_OF", "PART_OF", "RELATED_TO", "LEADS_TO", "ASSESSED_BY"
- strength: Integer 1-5 (1=weak, 5=strong)
- reason: One sentence explaining why this relationship exists

RELATIONSHIP TYPE DEFINITIONS:
- PREREQUISITE_OF: source must be learned before target. (HINT: Use 'week_or_unit' and 'difficulty_level' to infer this. Earlier weeks are usually prerequisites for later weeks. Beginner topics are prerequisites for intermediate/advanced ones.)
- PART_OF: source is a subtopic/component of target
- RELATED_TO: source and target are conceptually related
- LEADS_TO: learning source naturally leads to target
- ASSESSED_BY: source topic is evaluated by target assessment

Output a JSON object with key "relationships" containing an array.
ONLY create relationships between entities in the list. Do NOT invent new entities."""

    messages = [
        SystemMessage(content=system_content),
        HumanMessage(content="Identify all relationships between these entities.")
    ]

    response = await json_llm.ainvoke(messages)

    try:
        parsed = json.loads(response.content)
        relationships = parsed.get("relationships", [])
        # Filter: only keep relationships where both source and target exist
        entity_names_lower = {n.lower() for n in entity_names}
        valid = [
            r for r in relationships
            if r.get("source", "").lower() in entity_names_lower
            and r.get("target", "").lower() in entity_names_lower
        ]
        return valid
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[extract_relationships] JSON parse error: {e}")
        return []


async def store_entities(syllabus_id: int, entities: List[Dict]) -> Dict[str, int]:
    """Store entities in PostgreSQL and generate embeddings in batch."""
    entity_name_to_id = {}

    if not entities:
        return entity_name_to_id

    # Batch generate all embeddings at once (1 API call instead of N)
    embed_texts = [
        f"{e['name']}. {e.get('description', '')}. Type: {e.get('type', 'topic')}. Level: {e.get('difficulty_level', 'intermediate')}"
        for e in entities
    ]
    
    print(f"[store_entities] Generating {len(embed_texts)} embeddings in batch...")
    if hasattr(embeddings_model, "aembed_documents"):
        all_embeddings = await embeddings_model.aembed_documents(embed_texts)
    else:
        all_embeddings = await asyncio.to_thread(embeddings_model.embed_documents, embed_texts)
    print(f"[store_entities] Embeddings generated.")

    rows = [
        (
            syllabus_id,
            entity["name"],
            entity.get("type", "topic"),
            entity.get("description", ""),
            entity.get("difficulty_level", "intermediate"),
            entity.get("week_or_unit"),
            str(all_embeddings[i]),
        )
        for i, entity in enumerate(entities)
    ]

    sql = """
        INSERT INTO public.syllabus_entities
            (syllabus_id, name, entity_type, description, difficulty_level, week_or_unit, embedding)
        VALUES %s
        ON CONFLICT (syllabus_id, name) DO UPDATE SET
            entity_type = EXCLUDED.entity_type,
            description = EXCLUDED.description,
            difficulty_level = EXCLUDED.difficulty_level,
            week_or_unit = EXCLUDED.week_or_unit,
            embedding = EXCLUDED.embedding
        RETURNING id, name;
    """

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                returned = execute_values(
                    cur,
                    sql,
                    rows,
                    template="(%s, %s, %s, %s, %s, %s, %s::vector)",
                    page_size=max(len(rows), 1),
                    fetch=True,
                )
                entity_name_to_id = {row["name"].lower(): row["id"] for row in returned}
                conn.commit()
    except Exception as e:
        print(f"[store_entities] Error storing entities: {e}")

    return entity_name_to_id


async def store_relationships(syllabus_id: int, relationships: List[Dict], entity_name_to_id: Dict[str, int]):
    """Store relationships in PostgreSQL."""
    stored = 0

    rows = []
    seen = set()

    for rel in relationships:
        source = rel.get("source", "").lower()
        target = rel.get("target", "").lower()
        source_id = entity_name_to_id.get(source)
        target_id = entity_name_to_id.get(target)

        if not source_id or not target_id:
            continue

        relationship_type = rel.get("relationship_type", "RELATED_TO")
        key = (source_id, target_id, relationship_type)
        if key in seen:
            continue
        seen.add(key)

        rows.append((
            syllabus_id,
            source_id,
            target_id,
            relationship_type,
            rel.get("strength", 3),
            rel.get("reason", "")
        ))

    if not rows:
        return 0

    sql = """
        INSERT INTO public.syllabus_relationships
            (syllabus_id, source_entity_id, target_entity_id, relationship_type, strength, reason)
        VALUES %s;
    """

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, sql, rows, page_size=max(len(rows), 1))
                conn.commit()
                stored = len(rows)
    except Exception as e:
        print(f"[store_relationships] Error: {e}")

    return stored


async def run_ingestion_pipeline(syllabus_id: int, raw_text: str) -> Dict[str, Any]:
    """Full GraphRAG ingestion pipeline."""
    print(f"[GraphRAG] Starting ingestion for syllabus {syllabus_id}")

    # Step 1: Chunk
    with StageTimer("chunk_text"):
        chunks = chunk_text(raw_text)
    print(f"[GraphRAG] Created {len(chunks)} chunks")

    # Step 2: Extract entities
    with StageTimer("extract_entities"):
        entities = await extract_entities(chunks)
    print(f"[GraphRAG] Extracted {len(entities)} entities")

    # Step 3: Extract relationships
    with StageTimer("extract_relationships"):
        relationships = await extract_relationships(entities)
    print(f"[GraphRAG] Extracted {len(relationships)} relationships")

    # Step 4: Store entities with embeddings
    with StageTimer("store_entities"):
        entity_name_to_id = await store_entities(syllabus_id, entities)
    print(f"[GraphRAG] Stored {len(entity_name_to_id)} entities in DB")

    # Step 5: Store relationships
    with StageTimer("store_relationships"):
        rel_count = await store_relationships(syllabus_id, relationships, entity_name_to_id)
    print(f"[GraphRAG] Stored {rel_count} relationships in DB")

    # Update syllabus status
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE public.syllabi SET status = 'completed', entity_count = %s, relationship_count = %s WHERE id = %s",
                (len(entity_name_to_id), rel_count, syllabus_id)
            )
            conn.commit()

    return {
        "entity_count": len(entity_name_to_id),
        "relationship_count": rel_count,
        "entities": [e["name"] for e in entities],
    }
