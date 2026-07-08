import re
from psycopg2 import sql
from langchain_core.tools import tool

from config.db import get_db_connection


def _normalize_table_names(table_names: str) -> list[str]:
    return [name.strip() for name in (table_names or "").split(",") if name.strip()]


def _get_public_tables(cur) -> list[str]:
    cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
        """
    )
    return [row["table_name"] for row in cur.fetchall()]


@tool
def sql_db_list_tables() -> str:
    """Input is an empty string, output is a comma-separated list of tables in the database."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                tables = _get_public_tables(cur)
                return ", ".join(tables)
    except Exception as e:
        return f"Error: {e}"


@tool
def sql_db_schema(table_names: str) -> str:
    """Input is a comma-separated list of tables. Output includes schema and up to 3 sample rows for each table."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                valid_tables = set(_get_public_tables(cur))
                results: list[str] = []

                for table in _normalize_table_names(table_names):
                    if table not in valid_tables:
                        results.append(f"Error: table_names {{{table!r}}} not found in database")
                        continue

                    cur.execute(
                        """
                        SELECT column_name, data_type, is_nullable
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = %s
                        ORDER BY ordinal_position;
                        """,
                        (table,),
                    )
                    columns = cur.fetchall()
                    col_lines = [
                        f"{col['column_name']} {col['data_type']} {'NULL' if col['is_nullable'] == 'YES' else 'NOT NULL'}"
                        for col in columns
                    ]
                    results.append(f"CREATE TABLE public.{table} (\n  " + ",\n  ".join(col_lines) + "\n);")

                    try:
                        query = sql.SQL("SELECT * FROM {} LIMIT 3").format(sql.Identifier(table))
                        cur.execute(query)
                        rows = cur.fetchall()
                        if rows:
                            col_names = list(rows[0].keys())
                            data_lines = ["\t".join(col_names)]
                            for row in rows:
                                data_lines.append("\t".join(str(row.get(col, "")) for col in col_names))
                            results.append(
                                "/*\n3 rows from "
                                + table
                                + " table:\n"
                                + "\n".join(data_lines)
                                + "\n*/"
                            )
                    except Exception as sample_err:
                        results.append(f"Error fetching sample rows: {sample_err}")

                return "\n\n".join(results)
    except Exception as e:
        return f"Error: {e}"


_BLOCKED_SQL = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|analyze)\b",
    re.IGNORECASE,
)


@tool
def sql_db_query(query: str) -> str:
    """Input is a detailed SQL query and output is the result. Only read-only SELECT/CTE/EXPLAIN queries are allowed."""
    raw = (query or "").strip()
    lower = raw.lower()

    if not raw:
        return "Error: Empty query."
    if _BLOCKED_SQL.search(raw):
        return "Error: Only read-only queries are allowed."
    if not (lower.startswith("select") or lower.startswith("with") or lower.startswith("explain")):
        return "Error: Query must start with SELECT, WITH, or EXPLAIN."

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(raw)
                rows = cur.fetchall()
                if not rows:
                    return "[]"
                return str(rows[:200])
    except Exception as e:
        return f"Error: {e}"


tools = [sql_db_list_tables, sql_db_schema, sql_db_query]
tools_by_name = {tool_item.name: tool_item for tool_item in tools}


def set_ta_auth_context(access_token: str = "") -> None:
    _ = access_token
