WITH ranked_rubrics AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY teacher_id, assignment_id, regexp_replace(lower(question_label), '\s+', '', 'g')
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.rubrics
)
DELETE FROM public.rubrics
USING ranked_rubrics
WHERE public.rubrics.id = ranked_rubrics.id
  AND ranked_rubrics.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS rubrics_teacher_assignment_question_label_unique
ON public.rubrics (
  teacher_id,
  assignment_id,
  regexp_replace(lower(question_label), '\s+', '', 'g')
);
