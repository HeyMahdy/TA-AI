const rubricSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    question_label: { type: 'string' },
    rubric_description: {
      type: 'object',
      description: 'The structural breakdown of grading criteria, penalties, and fatal flaws.',
      properties: {
        criteria: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              points: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['points', 'description'],
          },
        },
        penalties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              deduction: { type: 'number' },
              condition: { type: 'string' },
            },
            required: ['deduction', 'condition'],
          },
        },
        fatal_flaw: { type: 'string', nullable: true },
      },
      required: ['criteria', 'penalties', 'fatal_flaw'],
    },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'question_label', 'rubric_description'],
} as const;

const rubricErrorSchema = {
  type: 'object',
  properties: { 
    error: { type: 'string' },
    details: { type: 'string', nullable: true }
  },
  required: ['error'],
} as const;

export const rubricPaths = {
  '/assignments/{assignmentId}/rubrics/upload': {
    post: {
      tags: ['Rubrics'],
      summary: 'Upload and process multiple rubric files',
      description: 'Accepts multiple rubric documents/images and processes them via the FastAPI Rubrics Agent layer.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'assignmentId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['files', 'is_handwritten'],
              properties: {
                files: {
                  type: 'array',
                  description: 'Array of rubric criteria sheets or template files',
                  items: {
                    type: 'string',
                    format: 'binary',
                  },
                },
                is_handwritten: {
                  type: 'string',
                  enum: ['true', 'false'],
                  description: 'Flag to determine parsing optimizations',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Rubrics processed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: { type: 'string', description: 'JSON string of extracted rubrics returned by the agent' },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Rubrics processed successfully',
                data: '{"rubrics":[{"question_label":"1a","rubric_description":{"criteria":[],"penalties":[],"fatal_flaw":null}}]}',
              },
            },
          },
        },
        '400': {
          description: 'Validation error / Missing components',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '401': {
          description: 'Unauthorized access',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '500': {
          description: 'Failed to process rubric document via Agent layer',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
      },
    },
  },
  '/assignments/{assignmentId}/rubrics': {
    post: {
      tags: ['Rubrics'],
      summary: 'Manually create a rubric for a question',
      description: 'Creates a rubric entry directly without file upload or AI processing.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'assignmentId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['question_label', 'rubric_description'],
              properties: {
                question_label: { type: 'string', description: 'The question label (e.g., "1a", "Q2")' },
                rubric_description: {
                  type: 'object',
                  description: 'The rubric structure',
                  properties: {
                    criteria: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          points: { type: 'number' },
                          description: { type: 'string' },
                        },
                        required: ['points', 'description'],
                      },
                    },
                    penalties: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          deduction: { type: 'number' },
                          condition: { type: 'string' },
                        },
                        required: ['deduction', 'condition'],
                      },
                    },
                    fatal_flaw: { type: 'string', nullable: true },
                  },
                  required: ['criteria', 'penalties', 'fatal_flaw'],
                },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Rubric created successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: rubricSchema,
                },
                required: ['message', 'data'],
              },
            },
          },
        },
        '400': {
          description: 'Missing required fields',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '401': {
          description: 'Unauthorized',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '500': {
          description: 'Database error',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
      },
    },
    get: {
      tags: ['Rubrics'],
      summary: 'Get all rubrics belonging to a specific assignment',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'assignmentId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'Rubrics retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  count: { type: 'integer' },
                  data: {
                    type: 'array',
                    items: rubricSchema,
                  },
                },
                required: ['message', 'count', 'data'],
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized: Missing teacher identity',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '500': {
          description: 'Database processing error',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
      },
    },
  },
  
  // 🚀 Perfectly matches your Express router params layout: /assignments/:rubricId/rubrics
  '/assignments/{rubricId}/rubrics': {
    patch: {
      tags: ['Rubrics'],
      summary: 'Update an existing rubric by its distinct ID',
      description: 'Dynamically updates provided optional fields (question_label, rubric_description) for a specific rubric row entry.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'rubricId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The unique integer database identifier of the rubric row to update',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                question_label: { type: 'string', description: 'Updated index positioning descriptor, e.g., 2 (a)' },
                rubric_description: {
                  type: 'object',
                  description: 'Partial or full criteria mapping payload structure matching jsonb requirements.',
                  properties: {
                    criteria: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          points: { type: 'number' },
                          description: { type: 'string' },
                        },
                      },
                    },
                    penalties: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          deduction: { type: 'number' },
                          condition: { type: 'string' },
                        },
                      },
                    },
                    fatal_flaw: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Rubric updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: rubricSchema,
                },
                required: ['message', 'data'],
              },
            },
          },
        },
        '400': {
          description: 'Bad Request',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '401': {
          description: 'Unauthorized',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '404': {
          description: 'Not Found',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '500': {
          description: 'Internal Server Error',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
      },
    },
  },
  '/assignments/{assignmentId}/rubrics/{rubricId}': {
    delete: {
      tags: ['Rubrics'],
      summary: 'Delete a rubric by assignment ID and rubric ID',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'assignmentId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'The assignment ID',
        },
        {
          name: 'rubricId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The rubric ID to delete',
        },
      ],
      responses: {
        '200': {
          description: 'Rubric deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      question_label: { type: 'string' },
                    },
                  },
                },
                required: ['message', 'data'],
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '404': {
          description: 'Rubric not found or unauthorized',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
        '500': {
          description: 'Database error',
          content: { 'application/json': { schema: rubricErrorSchema } },
        },
      },
    },
  },
} as const;
