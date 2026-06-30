const studentAnswerSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    question_label: { type: 'string' },
    answer: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'question_label', 'answer'],
};

const studentAnswerErrorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    details: { type: 'string', nullable: true },
  },
  required: ['error'],
};

export const studentAnswerPaths: Record<string, any> = {
  '/assignments/{assignmentId}/students/{studentId}/answers/upload': {
    post: {
      tags: ['Student Answers'],
      summary: 'Upload and process student answer files',
      description: 'Accepts multiple student answer files and extracts answers using AI OCR.',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'assignmentId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'studentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
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
                  description: 'Array of student answer sheets (max 10)',
                  items: { type: 'string', format: 'binary' },
                },
                is_handwritten: {
                  type: 'string',
                  enum: ['true', 'false'],
                  description: 'Whether the answers are handwritten',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Student answers processed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  data: { type: 'string', description: 'JSON string of extracted student answers returned by the agent' },
                },
                required: ['message', 'data'],
              },
              example: {
                message: 'Student answers processed successfully',
                data: '{"answers":[{"question_label":"1a","answer":"Student answer text."}]}',
              },
            },
          },
        },
        '400': { description: 'No files uploaded', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
        '500': { description: 'Failed to process', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
      },
    },
  },
  '/assignments/{assignmentId}/students/{studentId}/answers': {
    get: {
      tags: ['Student Answers'],
      summary: 'Get all answers for a student on an assignment',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'assignmentId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'studentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': {
          description: 'Student answers retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  count: { type: 'integer' },
                  data: { type: 'array', items: studentAnswerSchema },
                },
                required: ['message', 'count', 'data'],
              },
            },
          },
        },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
        '500': { description: 'Database error', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
      },
    },
  },
  '/student-answers/{answerId}': {
    patch: {
      tags: ['Student Answers'],
      summary: 'Update a student answer by ID',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'answerId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                question_label: { type: 'string' },
                answer: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Student answer updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { message: { type: 'string' }, data: studentAnswerSchema },
                required: ['message', 'data'],
              },
            },
          },
        },
        '401': { description: 'Unauthorized', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
        '404': { description: 'Not found', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
        '500': { description: 'Database error', content: { 'application/json': { schema: studentAnswerErrorSchema } } },
      },
    },
  },
};
