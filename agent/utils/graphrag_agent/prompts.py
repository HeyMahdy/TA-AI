ENTITY_EXTRACTION_PROMPT = """You are an academic curriculum analyst. Extract all academic topics, concepts, skills, and modules from this syllabus chunk.

For each entity, output a JSON object with these fields:
- name: The canonical name of the topic/concept (short, clear)
- type: One of "topic", "concept", "skill", "module"
- description: A one-sentence description of what this covers
- difficulty_level: One of "beginner", "intermediate", "advanced"
- week_or_unit: The week number or unit name if mentioned, otherwise null

Output a JSON object with key "entities" containing an array of entities.
ONLY extract what is explicitly mentioned. Do NOT invent topics.

Example output:
{
  "entities": [
    {"name": "Recursion", "type": "topic", "description": "A technique where a function calls itself to solve sub-problems", "difficulty_level": "intermediate", "week_or_unit": "Week 5"},
    {"name": "Dynamic Programming", "type": "topic", "description": "Optimization technique using memoization of overlapping subproblems", "difficulty_level": "advanced", "week_or_unit": "Week 8"}
  ]
}
"""

RELATIONSHIP_EXTRACTION_PROMPT = """You are an academic curriculum analyst. Given these academic entities extracted from a syllabus, identify relationships between them.

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
ONLY create relationships between entities in the list. Do NOT invent new entities.

Example:
{
  "relationships": [
    {"source": "Functions", "target": "Recursion", "relationship_type": "PREREQUISITE_OF", "strength": 5, "reason": "Understanding functions is required before learning recursion"},
    {"source": "Recursion", "target": "Dynamic Programming", "relationship_type": "LEADS_TO", "strength": 4, "reason": "Recursion concepts directly lead to understanding DP"}
  ]
}
"""

QUERY_SYNTHESIS_PROMPT = """You are an academic advisor AI. Answer the user's question using the provided knowledge graph context from their syllabus.

MATCHED ENTITIES FROM SYLLABUS:
{matched_entities}

GRAPH RELATIONSHIPS:
Prerequisites: {prerequisites}
Dependents (topics that depend on these): {dependents}
Related topics: {related_topics}

USER QUESTION: {query}

Provide a clear, helpful answer that:
1. Directly addresses the question
2. References specific topics from the syllabus
3. Explains prerequisite chains if relevant
4. Suggests learning order if applicable

Be concise and practical. If the question asks about prerequisites, list them in order from foundational to advanced.
"""
