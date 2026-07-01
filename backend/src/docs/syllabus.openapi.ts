const syllabusErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    details: { type: 'string', nullable: true },
  },
  required: ['error'],
};

export const syllabusPaths: Record<string, any> = {
  '/assignments/{assignmentId}/syllabus/upload': {
    post: {
      tags: ['Syllabus GraphRAG'],
      summary: 'Upload a syllabus and trigger GraphRAG ingestion',
      description: 'Accepts a PDF, DOCX, or TXT file scoped to a specific assignment. The syllabus ID is generated after upload. Extracts entities and relationships using AI, stores them with vector embeddings for semantic search. Re-uploading for the same assignment replaces the previous syllabus.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'assignmentId', in: 'path', required: true, schema: { type: 'integer' }, description: 'The assignment ID' },
      ],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Syllabus file (PDF, DOCX, or TXT)',
                },
              },
            },
          },
        },
      },
      responses: {
        '202': {
          description: 'Syllabus upload accepted for processing',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      syllabus_id: { type: 'integer' },
                      status: { type: 'string' },
                      entity_count: { type: 'integer' },
                      relationship_count: { type: 'integer' },
                    },
                  },
                },
              },
              example: {
                message: 'Syllabus upload accepted for processing',
                data: {
                  syllabus_id: 1,
                  status: 'processing',
                  entity_count: 0,
                  relationship_count: 0,
                },
              },
            },
          },
        },
        '400': { description: 'Invalid assignmentId path param, no file uploaded, or text extraction failed', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '500': { description: 'Processing failed', content: { 'application/json': { schema: syllabusErrorSchema } } },
      },
    },
  },
  '/syllabus/{syllabusId}/status': {
    get: {
      tags: ['Syllabus GraphRAG'],
      summary: 'Get syllabus ingestion status',
      description: 'Returns the current ingestion status for a syllabus from the GraphRAG agent service.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'syllabusId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        '200': {
          description: 'Syllabus status retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Status payload returned by the GraphRAG agent service.',
                  },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Syllabus status retrieved',
                data: {
                  syllabus_id: 1,
                  status: 'completed',
                },
              },
            },
          },
        },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '500': { description: 'Failed to fetch syllabus status', content: { 'application/json': { schema: syllabusErrorSchema } } },
      },
    },
  },
  '/assignments/{assignmentId}/syllabus/{syllabusId}/graph': {
    get: {
      tags: ['Syllabus GraphRAG'],
      summary: 'Get the full entity-relationship graph for a syllabus',
      description: 'Returns all extracted topics (nodes) and their relationships (edges) for visualization. Both assignmentId and syllabusId are required path parameters.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'assignmentId', in: 'path', required: true, schema: { type: 'integer' }, description: 'The assignment ID' },
        { name: 'syllabusId', in: 'path', required: true, schema: { type: 'integer' }, description: 'The syllabus ID' },
      ],
      responses: {
        '200': {
          description: 'Graph retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      nodes: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer' },
                            name: { type: 'string' },
                            entity_type: { type: 'string' },
                            description: { type: 'string' },
                            difficulty_level: { type: 'string' },
                            week_or_unit: { type: 'string', nullable: true },
                          },
                        },
                      },
                      edges: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer' },
                            source: { type: 'string' },
                            target: { type: 'string' },
                            relationship_type: { type: 'string' },
                            strength: { type: 'integer' },
                            reason: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid or missing assignmentId or syllabusId path param', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '500': { description: 'Failed to fetch graph', content: { 'application/json': { schema: syllabusErrorSchema } } },
      },
    },
  },
  '/syllabus/query': {
    post: {
      tags: ['Syllabus GraphRAG'],
      summary: 'Query the syllabus using natural language',
      description: 'Performs vector search to find matching topics, retrieves graph relationships, and synthesizes an answer using LLM. Both syllabus_id and assignment_id are required.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query', 'syllabus_id', 'assignment_id'],
              properties: {
                query: { type: 'string', description: 'Natural language question about the syllabus' },
                syllabus_id: { type: 'integer', description: 'The syllabus ID' },
                assignment_id: { type: 'integer', description: 'The assignment ID' },
              },
            },
            example: {
              query: 'What do I need to learn before Dynamic Programming?',
              syllabus_id: 1,
              assignment_id: 1,
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Query completed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      answer: { type: 'string' },
                      graph_context: {
                        type: 'object',
                        properties: {
                          prerequisites: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                entity_type: { type: 'string' },
                                difficulty_level: { type: 'string' },
                              },
                            },
                          },
                          dependents: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                entity_type: { type: 'string' },
                                difficulty_level: { type: 'string' },
                              },
                            },
                          },
                          related: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                entity_type: { type: 'string' },
                                difficulty_level: { type: 'string' },
                                relationship_type: { type: 'string' },
                                reason: { type: 'string' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '400': { description: 'Missing query, syllabus_id, or assignment_id', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '404': { description: 'No completed syllabus found for the given assignment', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '500': { description: 'Query failed', content: { 'application/json': { schema: syllabusErrorSchema } } },
      },
    },
  },
  '/syllabus/{syllabusId}/prerequisites/{topic}': {
    get: {
      tags: ['Syllabus GraphRAG'],
      summary: 'Get the full prerequisite chain for a topic',
      description: 'Recursively traverses the graph to return all prerequisites from foundational to advanced.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'syllabusId', in: 'path', required: true, schema: { type: 'integer' } },
        { name: 'topic', in: 'path', required: true, schema: { type: 'string' }, description: 'The topic name to find prerequisites for' },
      ],
      responses: {
        '200': {
          description: 'Prerequisites retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      topic: { type: 'string' },
                      prerequisite_chain: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            entity_type: { type: 'string' },
                            difficulty_level: { type: 'string' },
                            depth: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: syllabusErrorSchema } } },
        '500': { description: 'Failed to fetch prerequisites', content: { 'application/json': { schema: syllabusErrorSchema } } },
      },
    },
  },
};
