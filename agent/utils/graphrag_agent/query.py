import json
from typing import Dict, Any, List

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import SystemMessage, HumanMessage

from config.db import get_db_connection
from .prompts import QUERY_SYNTHESIS_PROMPT

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")


async def vector_search(syllabus_id: int, query: str, top_k: int = 5) -> List[Dict]:
    """Query pgvector for top-K matching entities."""
    query_embedding = embeddings_model.embed_query(query)

    sql = """
        SELECT id, name, entity_type, description, difficulty_level, week_or_unit,
               1 - (embedding <=> %s::vector) as similarity
        FROM public.syllabus_entities
        WHERE syllabus_id = %s AND embedding IS NOT NULL
        ORDER BY embedding <=> %s::vector
        LIMIT %s;
    """

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (str(query_embedding), syllabus_id, str(query_embedding), top_k))
            rows = cur.fetchall()

    return [dict(row) for row in rows]


async def get_graph_context(syllabus_id: int, entity_ids: List[int]) -> Dict[str, List]:
    """Query PostgreSQL for relationships of matched entities."""
    if not entity_ids:
        return {"prerequisites": [], "dependents": [], "related": []}

    # Get prerequisites (things that come before these entities)
    prereq_sql = """
        SELECT DISTINCT e.name, e.entity_type, e.difficulty_level
        FROM public.syllabus_relationships r
        JOIN public.syllabus_entities e ON e.id = r.source_entity_id
        WHERE r.target_entity_id = ANY(%s)
        AND r.relationship_type IN ('RELATED_TO', 'PART_OF')
        AND r.syllabus_id = %s;
    """

    # Get dependents (things that depend on these entities)
    dep_sql = """
        SELECT DISTINCT e.name, e.entity_type, e.difficulty_level
        FROM public.syllabus_relationships r
        JOIN public.syllabus_entities e ON e.id = r.target_entity_id
        WHERE r.source_entity_id = ANY(%s)
        AND r.relationship_type IN ('RELATED_TO', 'PART_OF')
        AND r.syllabus_id = %s;
    """

    # Get related topics (other relationship types)
    related_sql = """
        SELECT DISTINCT e.name, e.entity_type, e.difficulty_level, r.relationship_type, r.reason
        FROM public.syllabus_relationships r
        JOIN public.syllabus_entities e ON (
            (e.id = r.source_entity_id AND r.target_entity_id = ANY(%s))
            OR (e.id = r.target_entity_id AND r.source_entity_id = ANY(%s))
        )
        WHERE r.syllabus_id = %s
        AND r.relationship_type NOT IN ('RELATED_TO', 'PART_OF');
    """

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(prereq_sql, (entity_ids, syllabus_id))
            prerequisites = [dict(r) for r in cur.fetchall()]

            cur.execute(dep_sql, (entity_ids, syllabus_id))
            dependents = [dict(r) for r in cur.fetchall()]

            cur.execute(related_sql, (entity_ids, entity_ids, syllabus_id))
            related = [dict(r) for r in cur.fetchall()]

    return {
        "prerequisites": prerequisites,
        "dependents": dependents,
        "related": related,
    }


async def get_prerequisite_chain(syllabus_id: int, topic_name: str) -> List[Dict]:
    """Recursively get the full prerequisite chain for a topic using a CTE."""
    sql = """
        WITH RECURSIVE prereq_chain AS (
            -- Base case: find the target topic
            SELECT e.id, e.name, e.entity_type, e.difficulty_level, 0 as depth
            FROM public.syllabus_entities e
            WHERE e.syllabus_id = %s AND LOWER(e.name) = LOWER(%s)

            UNION ALL

            -- Recursive case: find prerequisites of current level
            SELECT parent.id, parent.name, parent.entity_type, parent.difficulty_level, pc.depth + 1
            FROM prereq_chain pc
            JOIN public.syllabus_relationships r ON r.target_entity_id = pc.id
            JOIN public.syllabus_entities parent ON parent.id = r.source_entity_id
            WHERE r.relationship_type = 'PREREQUISITE_OF'
            AND r.syllabus_id = %s
            AND pc.depth < 10  -- prevent infinite loops
        )
        SELECT DISTINCT name, entity_type, difficulty_level, depth
        FROM prereq_chain
        ORDER BY depth DESC;
    """

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (syllabus_id, topic_name, syllabus_id))
            rows = cur.fetchall()

    return [dict(r) for r in rows]


async def query_graphrag(syllabus_id: int, query: str) -> Dict[str, Any]:
    """Full query pipeline: vector search → graph context → LLM synthesis."""

    # Step 1: Vector search for matching entities
    matched = await vector_search(syllabus_id, query)

    if not matched:
        return {
            "answer": "No relevant topics found in this syllabus for your query.",
            "graph_context": {"prerequisites": [], "dependents": [], "related": []}
        }

    entity_ids = [m["id"] for m in matched]

    # Step 2: Get graph relationships
    graph_ctx = await get_graph_context(syllabus_id, entity_ids)

    # Step 3: Synthesize answer with LLM
    matched_str = json.dumps([{"name": m["name"], "type": m["entity_type"], "level": m["difficulty_level"]} for m in matched], indent=2)
    prereq_str = json.dumps([p["name"] for p in graph_ctx["prerequisites"]])
    dep_str = json.dumps([d["name"] for d in graph_ctx["dependents"]])
    related_str = json.dumps([r["name"] for r in graph_ctx["related"]])

    messages = [
        SystemMessage(content=QUERY_SYNTHESIS_PROMPT.format(
            matched_entities=matched_str,
            prerequisites=prereq_str,
            dependents=dep_str,
            related_topics=related_str,
            query=query
        )),
        HumanMessage(content=query)
    ]

    response = llm.invoke(messages)

    return {
        "answer": response.content,
        "graph_context": graph_ctx,
    }


async def get_full_graph(syllabus_id: int) -> Dict[str, Any]:
    """Get the full entity-relationship graph for a syllabus."""

    nodes_sql = """
        SELECT id, name, entity_type, description, difficulty_level, week_or_unit
        FROM public.syllabus_entities
        WHERE syllabus_id = %s
        ORDER BY id;
    """

    edges_sql = """
        SELECT r.id, s.name as source, t.name as target, r.relationship_type, r.strength, r.reason
        FROM public.syllabus_relationships r
        JOIN public.syllabus_entities s ON s.id = r.source_entity_id
        JOIN public.syllabus_entities t ON t.id = r.target_entity_id
        WHERE r.syllabus_id = %s;
    """

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(nodes_sql, (syllabus_id,))
            nodes = [dict(r) for r in cur.fetchall()]

            cur.execute(edges_sql, (syllabus_id,))
            edges = [dict(r) for r in cur.fetchall()]

    return {"nodes": nodes, "edges": edges}
