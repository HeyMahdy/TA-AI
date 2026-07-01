CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.student_answers
  DROP CONSTRAINT IF EXISTS student_answers_student_fkey;

ALTER TABLE IF EXISTS public.student_question_scores
  DROP CONSTRAINT IF EXISTS student_question_scores_student_fkey;

ALTER TABLE IF EXISTS public.grading_jobs
  DROP CONSTRAINT IF EXISTS grading_jobs_student_fkey;

ALTER TABLE IF EXISTS public.student_weak_concepts
  DROP CONSTRAINT IF EXISTS student_weak_concepts_student_fkey;

ALTER TABLE IF EXISTS public.remediation_exercises
  DROP CONSTRAINT IF EXISTS remediation_exercises_student_fkey;

ALTER TABLE IF EXISTS public.students
  DROP CONSTRAINT IF EXISTS students_pkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'id'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.students RENAME COLUMN id TO student_id;
    ALTER TABLE public.students ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
  END IF;
END $$;

ALTER TABLE IF EXISTS public.students
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN student_id SET NOT NULL;

ALTER TABLE IF EXISTS public.students
  ADD CONSTRAINT students_pkey PRIMARY KEY (id);

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_teacher_uuid_unique') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_teacher_uuid_unique UNIQUE (teacher_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_teacher_student_id_unique') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_teacher_student_id_unique UNIQUE (teacher_id, student_id);
  END IF;
END $$;

DO $$
DECLARE
  child_table text;
  has_unmapped boolean;
BEGIN
  FOREACH child_table IN ARRAY ARRAY[
    'student_answers',
    'student_question_scores',
    'grading_jobs',
    'student_weak_concepts'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = child_table
        AND column_name = 'student_id'
        AND data_type <> 'uuid'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN student_uuid uuid', child_table);
      EXECUTE format(
        'UPDATE public.%I target
         SET student_uuid = students.id
         FROM public.students
         WHERE target.teacher_id = students.teacher_id
           AND target.student_id = students.student_id',
        child_table
      );

      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE student_uuid IS NULL)', child_table)
      INTO has_unmapped;

      IF has_unmapped THEN
        RAISE EXCEPTION 'Could not map every %.student_id value to students.id', child_table;
      END IF;

      EXECUTE format('ALTER TABLE public.%I DROP COLUMN student_id', child_table);
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN student_uuid TO student_id', child_table);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN student_id SET NOT NULL', child_table);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  child_table text;
BEGIN
  FOREACH child_table IN ARRAY ARRAY[
    'student_answers',
    'student_question_scores',
    'grading_jobs',
    'student_weak_concepts'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = child_table
        AND column_name = 'student_id'
        AND data_type = 'uuid'
    ) AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = child_table
        AND column_name = 'teacher_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = child_table || '_student_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I
         ADD CONSTRAINT %I FOREIGN KEY (teacher_id, student_id)
         REFERENCES public.students(teacher_id, id)',
        child_table,
        child_table || '_student_fkey'
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'remediation_exercises'
      AND column_name = 'student_id'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.remediation_exercises ADD COLUMN student_uuid uuid;

    UPDATE public.remediation_exercises target
    SET student_uuid = students.id
    FROM public.students
    WHERE target.student_id = students.student_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.students duplicates
        WHERE duplicates.student_id = students.student_id
          AND duplicates.id <> students.id
      );

    IF EXISTS (SELECT 1 FROM public.remediation_exercises WHERE student_uuid IS NULL) THEN
      RAISE EXCEPTION 'Could not map every remediation_exercises.student_id value to a unique students.id';
    END IF;

    ALTER TABLE public.remediation_exercises DROP COLUMN student_id;
    ALTER TABLE public.remediation_exercises RENAME COLUMN student_uuid TO student_id;
    ALTER TABLE public.remediation_exercises ALTER COLUMN student_id SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'remediation_exercises'
      AND column_name = 'student_id'
      AND data_type = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'remediation_exercises_student_fkey'
  ) THEN
    ALTER TABLE public.remediation_exercises
      ADD CONSTRAINT remediation_exercises_student_fkey
      FOREIGN KEY (student_id)
      REFERENCES public.students(id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_students_teacher_id
    ON public.students(teacher_id);

    CREATE INDEX IF NOT EXISTS idx_students_teacher_student_id
    ON public.students(teacher_id, student_id);
  END IF;

  IF to_regclass('public.student_answers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_student_answers_student
    ON public.student_answers(student_id);
  END IF;

  IF to_regclass('public.student_question_scores') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_student_question_scores_student
    ON public.student_question_scores(student_id);
  END IF;

  IF to_regclass('public.grading_jobs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_grading_jobs_student
    ON public.grading_jobs(student_id);
  END IF;

  IF to_regclass('public.student_weak_concepts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_student_weak_concepts_student
    ON public.student_weak_concepts(student_id);
  END IF;

  IF to_regclass('public.remediation_exercises') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_remediation_exercises_student
    ON public.remediation_exercises(student_id);
  END IF;
END $$;
