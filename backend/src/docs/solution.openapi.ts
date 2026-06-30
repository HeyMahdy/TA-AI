const solutionSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    question_label: { type: 'string' },
    solution_text: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'question_label', 'solution_text'],
} as const;

const solutionErrorSchema = {
  type: 'object',
  properties: { 
    error: { type: 'string' },
    details: { type: 'string', nullable: true }
  },
  required: ['error'],
} as const;

export const solutionPaths: Record<string, any> = {
  '/assignments/{assignmentId}/solutions/upload': {
    post: {
      tags: ['Solutions'],
      summary: 'Upload and process multiple solution files',
      description: 'Accepts multiple solution document files and routes them through the FastAPI Solutions Agent layer.',
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
                  description: 'Array of solution sheets or template files',
                  items: {
                    type: 'string',
                    format: 'binary',
                  },
                },
                is_handwritten: {
                  type: 'string',
                  enum: ['true', 'false'],
                  description: 'Flag to determine parsing stream (LLM Vision vs Textract)',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Solutions processed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: { type: 'string', description: 'JSON string of extracted solutions returned by the agent' },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Solutions processed successfully',
                data: '{"solutions":[{"question_label":"1a","solution_text":"Answer text."}]}',
              },
            },
          },
        },
        '400': {
          description: 'Validation error / No files uploaded',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '401': {
          description: 'Unauthorized access',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '500': {
          description: 'Failed to process solution document via Agent layer',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
      },
    },
  },
  '/assignments/{assignmentId}/solutions': {
    get: {
      tags: ['Solutions'],
      summary: 'Get all solutions belonging to a specific assignment',
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
          description: 'Solutions retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  count: { type: 'integer' },
                  data: {
                    type: 'array',
                    items: solutionSchema,
                  },
                },
                required: ['message', 'count', 'data'],
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized: Missing teacher identity',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '500': {
          description: 'Database processing error',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
      },
    },
  },
  
  '/assignments/{solutionId}/solutions': {
    patch: {
      tags: ['Solutions'],
      summary: 'Update an existing solution by its distinct ID',
      description: 'Dynamically updates provided optional fields (question_label, solution_text) for a specific solution row entry.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'solutionId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The unique integer database key identifier of the solution to update',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                question_label: { type: 'string', description: 'Updated index positioning descriptor, e.g., 1 (b)' },
                solution_text: { type: 'string', description: 'The modified solution content or LaTeX text code block' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Solution updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: solutionSchema,
                },
                required: ['message', 'data'],
              },
            },
          },
        },
        '400': {
          description: 'Bad Request: Provided payload contains no editable target properties or invalid body syntax',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '401': {
          description: 'Unauthorized: Authentication validation token missing or expired',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '404': {
          description: 'Not Found: Target solution does not exist or access privileges deny modifications',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '500': {
          description: 'Internal Server Error: Database pipeline connection crash',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
      },
    },
  },
  '/assignments/{assignmentId}/solutions/{solutionId}': {
    delete: {
      tags: ['Solutions'],
      summary: 'Delete a teacher solution by assignment ID and solution ID',
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
          name: 'solutionId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The solution ID to delete',
        },
      ],
      responses: {
        '200': {
          description: 'Solution deleted successfully',
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
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '404': {
          description: 'Solution not found or unauthorized',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
        '500': {
          description: 'Database error',
          content: { 'application/json': { schema: solutionErrorSchema } },
        },
      },
    },
  },
};
