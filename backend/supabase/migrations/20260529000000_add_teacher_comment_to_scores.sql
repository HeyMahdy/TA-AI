ALTER TABLE IF EXISTS public.student_question_scores
  ADD COLUMN IF NOT EXISTS teacher_comment text;
