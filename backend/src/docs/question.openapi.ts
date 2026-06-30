const questionSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    question_label: { type: 'string' },
    question_description: { type: 'string' },
    marks: { type: 'integer', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'question_label', 'question_description'],
} as const;

const questionErrorSchema = {
  type: 'object',
  properties: { 
    error: { type: 'string' },
    details: { type: 'string', nullable: true }
  },
  required: ['error'],
} as const;

export const questionPaths = {
  '/assignments/{assignmentId}/questions/upload': {
    post: {
      tags: ['Questions'],
      summary: 'Upload and process multiple question files',
      description: 'Accepts multiple file buffers and routes them through the FastAPI AI module.',
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
                  description: 'Array of exam sheets, templates, or question files',
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
          description: 'Questions processed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: { type: 'string', description: 'JSON string of extracted questions returned by the agent' },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Questions processed successfully',
                data: '{"questions":[{"question_label":"1a","question_description":"Define SHM."}]}',
              },
            },
          },
        },
        '400': {
          description: 'Validation error / No files uploaded',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '401': {
          description: 'Unauthorized access',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '500': {
          description: 'Failed to process question document via Agent layer',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
      },
    },
  },
  '/assignments/{assignmentId}/questions': {
    get: {
      tags: ['Questions'],
      summary: 'Get all questions belonging to a specific assignment',
      description: 'Returns questions sorted by a normalized natural question-label order after fetching from the database.',
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
          description: 'Questions retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  count: { type: 'integer' },
                  data: {
                    type: 'array',
                    items: questionSchema,
                  },
                },
                required: ['message', 'count', 'data'],
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized: Missing teacher identity',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '500': {
          description: 'Database processing error',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
      },
    },
  },
  
  // 🚀 FIXED: Now perfectly maps to your exact Express routing parameters layout
  '/assignments/{questionId}/questions': {
    patch: {
      tags: ['Questions'],
      summary: 'Update an existing question by its distinct ID',
      description: 'Dynamically updates provided optional fields (label, description, marks) for a specific question row entry.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'questionId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The unique integer database key identifier of the question to update',
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
                question_description: { type: 'string', description: 'The modified prompt content or LaTeX text code block' },
                marks: { type: 'integer', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Question updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: questionSchema,
                },
                required: ['message', 'data'],
              },
            },
          },
        },
        '400': {
          description: 'Bad Request: Provided payload contains no editable target properties or invalid body syntax',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '401': {
          description: 'Unauthorized: Authentication validation token missing or expired',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '404': {
          description: 'Not Found: Target question does not exist or access privileges deny modifications',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '500': {
          description: 'Internal Server Error: Database pipeline connection crash',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
      },
    },
    delete: {
      tags: ['Questions'],
      summary: 'Delete a question by its distinct ID',
      description: 'Deletes a specific question row owned by the authenticated teacher.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'questionId',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          description: 'The unique integer database key identifier of the question to delete',
        },
      ],
      responses: {
        '200': {
          description: 'Question deleted successfully',
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
                    required: ['id', 'question_label'],
                  },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Question deleted successfully',
                data: {
                  id: 1,
                  question_label: '1a',
                },
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized: Authentication validation token missing or expired',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '404': {
          description: 'Not Found: Target question does not exist or access privileges deny deletion',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
        '500': {
          description: 'Internal Server Error: Database pipeline connection crash',
          content: { 'application/json': { schema: questionErrorSchema } },
        },
      },
    },
  },
} as const;
