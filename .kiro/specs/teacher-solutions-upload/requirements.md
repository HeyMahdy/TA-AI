# Requirements Document

## Introduction

The Teacher Solutions Upload feature enables teachers to upload solution documents (images/PDFs) for assignments, extract solution text using OCR/vision AI, and manage these solutions through retrieval and update operations. This feature follows the exact architectural pattern established by the existing questions and rubrics implementations, utilizing a Node.js/TypeScript backend controller that forwards file uploads to a Python/FastAPI agent service for AI-powered extraction and database persistence.

## Glossary

- **Teacher_Solutions_System**: The complete system encompassing backend controller, agent service, and database operations for managing teacher solution documents
- **Backend_Controller**: The Node.js/TypeScript Express controller handling HTTP requests, authentication, and communication with the Agent_Service
- **Agent_Service**: The Python/FastAPI service that processes uploaded files using vision AI and LangGraph workflows
- **Solution_Document**: An image or PDF file containing teacher-provided solutions for assignment questions
- **Solution_Record**: A database entry containing teacher_id, assignment_id, question_label, and solution_text
- **Vision_Extractor**: The LangGraph node that uses OCR/vision LLM to extract text from uploaded documents
- **Database_Tool**: The LangGraph tool that inserts solution records into PostgreSQL
- **Teacher_Identity**: The authenticated teacher's UUID from JWT token

## Requirements

### Requirement 1: Solution Document Upload

**User Story:** As a teacher, I want to upload solution documents for an assignment, so that the system can extract and store solution text for each question.

#### Acceptance Criteria

1. WHEN a teacher uploads one or more solution files (images or PDFs), THE Backend_Controller SHALL accept up to 10 files via multipart/form-data
2. WHEN files are received, THE Backend_Controller SHALL verify the teacher's JWT authentication token
3. WHEN authentication succeeds, THE Backend_Controller SHALL forward the files to the Agent_Service at `/internal/agent/solutions/process`
4. WHEN the Agent_Service receives files, THE Vision_Extractor SHALL convert files to base64 images using parse_standard_file
5. WHEN files are converted, THE Vision_Extractor SHALL use a vision LLM to extract solution text with question labels
6. WHEN extraction completes, THE Database_Tool SHALL insert solution records with teacher_id, assignment_id, question_label, and solution_text
7. WHEN all records are saved, THE Agent_Service SHALL return the processed analysis to the Backend_Controller
8. WHEN the Backend_Controller receives the response, THE Backend_Controller SHALL return a 200 status with the analysis data

### Requirement 2: Solution Retrieval by Assignment

**User Story:** As a teacher, I want to retrieve all solutions for a specific assignment, so that I can review what solutions have been uploaded.

#### Acceptance Criteria

1. WHEN a teacher requests solutions for an assignment, THE Backend_Controller SHALL verify the Teacher_Identity from the JWT token
2. WHEN authentication succeeds, THE Backend_Controller SHALL query the database for solution records matching the assignment_id and teacher_id
3. WHEN records are found, THE Backend_Controller SHALL return a 200 status with id, question_label, solution_text, and created_at for each record
4. WHEN records are ordered, THE Backend_Controller SHALL sort results by id in ascending order
5. WHEN no records exist, THE Backend_Controller SHALL return a 200 status with an empty data array and count of 0

### Requirement 3: Solution Record Update

**User Story:** As a teacher, I want to update existing solution records, so that I can correct or modify solution text and question labels.

#### Acceptance Criteria

1. WHEN a teacher requests to update a solution record, THE Backend_Controller SHALL verify the Teacher_Identity from the JWT token
2. WHEN the request includes question_label, THE Backend_Controller SHALL update the question_label field if the value is a non-empty string
3. WHEN the request includes solution_text, THE Backend_Controller SHALL update the solution_text field if the value is a non-empty string
4. WHEN no valid update fields are provided, THE Backend_Controller SHALL return the existing record without modification and a 200 status
5. WHEN update fields are valid, THE Backend_Controller SHALL execute the update only if the record belongs to the authenticated teacher
6. WHEN the update succeeds, THE Backend_Controller SHALL return a 200 status with the updated record including id, question_label, solution_text, and created_at
7. WHEN the record does not exist or belongs to a different teacher, THE Backend_Controller SHALL return a 404 status with an authorization error message

### Requirement 4: Authentication and Authorization

**User Story:** As a system administrator, I want all solution operations to be authenticated and scoped to the teacher's identity, so that teachers can only access their own solutions.

#### Acceptance Criteria

1. THE Backend_Controller SHALL apply JWT authentication middleware to all solution routes
2. WHEN authentication fails, THE Backend_Controller SHALL return a 401 status with an "Unauthorized" error message
3. WHEN a teacher uploads solutions, THE Backend_Controller SHALL include the Teacher_Identity in the request to the Agent_Service
4. WHEN a teacher retrieves solutions, THE Backend_Controller SHALL filter results by the Teacher_Identity
5. WHEN a teacher updates a solution, THE Backend_Controller SHALL verify ownership by matching the Teacher_Identity with the record's teacher_id

### Requirement 5: Agent Service Architecture

**User Story:** As a developer, I want the solution upload feature to follow the same LangGraph architecture as questions and rubrics, so that the codebase remains consistent and maintainable.

#### Acceptance Criteria

1. THE Agent_Service SHALL implement a solutions_agent module with graph.py, node.py, state.py, tools.py, and prompt.py files
2. THE Vision_Extractor SHALL be implemented as a LangGraph node that processes files and returns extracted JSON
3. THE Database_Tool SHALL be implemented as a LangChain tool with InsertSolutionInput schema
4. WHEN the graph executes, THE Agent_Service SHALL follow the workflow: extract_node → save_agent → tool_node (conditional) → END
5. WHEN the save_agent node decides to call tools, THE Agent_Service SHALL route to tool_node and loop back to save_agent
6. WHEN the save_agent node completes without tool calls, THE Agent_Service SHALL route to END
7. THE Agent_Service SHALL use the same should_continue conditional logic pattern as questions and rubrics agents

### Requirement 6: Database Integration

**User Story:** As a developer, I want solution records to be stored in the existing teacher_solutions table, so that the database schema remains consistent with the provided structure.

#### Acceptance Criteria

1. THE Database_Tool SHALL insert records into the public.teacher_solutions table
2. WHEN inserting a record, THE Database_Tool SHALL include teacher_id (uuid), assignment_id (integer), question_label (text), and solution_text (text)
3. WHEN insertion succeeds, THE Database_Tool SHALL return the new record's id
4. WHEN insertion fails, THE Database_Tool SHALL return a descriptive error message
5. THE Backend_Controller SHALL query the teacher_solutions table using parameterized queries to prevent SQL injection

### Requirement 7: Error Handling

**User Story:** As a teacher, I want clear error messages when operations fail, so that I can understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN no files are uploaded, THE Backend_Controller SHALL return a 400 status with "No solution files uploaded" error message
2. WHEN the Agent_Service communication fails, THE Backend_Controller SHALL return a 500 status with "Failed to process solution document" and error details
3. WHEN database queries fail, THE Backend_Controller SHALL return a 500 status with "Database error" and error details
4. WHEN authentication is missing, THE Backend_Controller SHALL return a 401 status with "Unauthorized: Missing teacher identity" error message
5. WHEN a solution record is not found during update, THE Backend_Controller SHALL return a 404 status with "Solution not found or you are not authorized to modify it" error message

### Requirement 8: File Processing Consistency

**User Story:** As a developer, I want solution file processing to use the same parse_standard_file utility as questions and rubrics, so that file handling remains consistent across all upload features.

#### Acceptance Criteria

1. THE Agent_Service SHALL use the parse_standard_file function from api.service.Textract_service to convert uploaded files
2. WHEN files are processed, THE Agent_Service SHALL support both image files and PDF files
3. WHEN files are converted, THE Agent_Service SHALL produce base64-encoded data URLs for vision LLM consumption
4. THE Agent_Service SHALL process multiple files in a single batch operation
5. THE Agent_Service SHALL inject document_type, teacher_id, and assignment_id metadata into the initial graph state

### Requirement 9: Route Configuration

**User Story:** As a developer, I want solution routes to follow the same URL pattern as questions and rubrics, so that the API remains consistent and predictable.

#### Acceptance Criteria

1. THE Backend_Controller SHALL expose a POST route at `/assignments/:assignmentId/solutions/upload` for uploading solutions
2. THE Backend_Controller SHALL expose a GET route at `/assignments/:assignmentId/solutions` for retrieving solutions
3. THE Backend_Controller SHALL expose a PATCH route at `/assignments/:solutionId/solutions` for updating solutions
4. THE Backend_Controller SHALL use multer with memoryStorage for file upload handling
5. THE Backend_Controller SHALL accept up to 10 files with the field name "files"
6. THE Backend_Controller SHALL apply requireAccessToken middleware to all solution routes

### Requirement 10: Vision Extraction Prompt

**User Story:** As a developer, I want the vision extraction prompt to be specifically designed for solution documents, so that the AI accurately extracts solution text with question labels.

#### Acceptance Criteria

1. THE Vision_Extractor SHALL use a system prompt that instructs the LLM to extract solution text with question labels
2. THE Vision_Extractor SHALL request JSON output with a "solutions" array containing objects with "question_label" and "solution_text" fields
3. THE Vision_Extractor SHALL use gpt-4o model for complex OCR vision tasks
4. THE Vision_Extractor SHALL bind response_format with type "json_object" to enforce structured output
5. THE Vision_Extractor SHALL use json.dumps with ensure_ascii=False to prevent encoding corruption
