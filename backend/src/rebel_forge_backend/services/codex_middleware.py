"""
Codex CLI middleware — translates between our chat SSE protocol and codex exec.

From the frontend's perspective, this produces identical SSE events as the vLLM path.
Internally it spawns codex exec, parses tool calls from the response text, executes
them using the same _execute_tool function, and streams results back.
"""
import json
import logging
from typing import AsyncGenerator

from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.services.codex_agent import run_codex

logger = logging.getLogger("rebel_forge_backend.codex_middleware")

# Map our tool names to the normalized types the frontend expects
TOOL_TYPE_MAP = {
    "generate_drafts": "generate",
    "web_search": "search",
    "approve_draft": "approve",
    "publish_draft": "publish",
    "run_heartbeat": "heartbeat",
    "update_brand": "update_brand",
    "setup_platform": "setup_platform",
    "save_onboarding": "save_onboarding",
    "recall_training": "recall_training",
}


async def stream_codex_response(
    *,
    user_message: str,
    last_user_message: str = "",
    system_prompt: str,
    mode: str,
    settings: Settings,
    db: Session,
    workspace,
    codex_session_id: str | None = None,
    codex_model: str | None = None,
) -> AsyncGenerator[str, None]:
    """
    Run a chat turn through Codex CLI and yield SSE events.
    Handles tool calls by executing them and optionally resuming the session.
    """
    from rebel_forge_backend.api.routes.chat import _execute_tool

    # Run codex
    result = await run_codex(
        prompt=user_message,
        system_prompt=system_prompt if not codex_session_id else "",
        session_id=codex_session_id,
        model=codex_model,
    )

    if result.error:
        yield f"data: {json.dumps({'content': f'Codex error: {result.error}'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # --- Agentic tool loop ---
    # After ANY tool call, feed result back to Codex. The model decides when
    # to stop by producing text instead of another tool call.
    max_rounds = 8
    all_tool_names = []
    all_tool_results = []
    current_result = result
    accumulated_context = ""
    final_text = ""
    last_tool_result = None

    for _round in range(max_rounds):
        if current_result.tool_call:
            tool_name = current_result.tool_call.get("tool", "")
            tool_args = current_result.tool_call.get("args", {})
            tool_summary = current_result.tool_call.get("summary", tool_name)
            tool_args["summary"] = tool_summary

            logger.info("[codex] round %d: executing tool %s", _round + 1, tool_name)

            try:
                tool_result = _execute_tool(tool_name, tool_args, settings, db, workspace)
            except Exception as e:
                logger.error("[codex] tool execution failed: %s", e)
                tool_result = {"type": tool_name, "status": "error", "message": str(e)}

            tool_result["summary"] = tool_summary
            all_tool_names.append(tool_name)
            all_tool_results.append(tool_result)
            last_tool_result = tool_result
            yield f"data: {json.dumps({'tool_result': tool_result})}\n\n"

            # Build context from tool result
            if tool_name == "recall_training":
                ctx = tool_result.get("context", "")
            elif tool_name == "web_search" and tool_result.get("results"):
                lines = [f"- {r.get('title', '')}: {r.get('description', '')}" for r in tool_result["results"][:5]]
                ctx = "Search results:\n" + "\n".join(lines)
            elif tool_name == "query_drafts" and tool_result.get("results"):
                ctx = json.dumps(tool_result["results"][:10])
            else:
                ctx = tool_result.get("message", "")

            accumulated_context += f"\n\n[{tool_name} result]:\n{ctx}"

            followup_prompt = f"{user_message}{accumulated_context}\n\nContinue with the user's request. If there are more platforms or tasks remaining, call the next tool. If everything is done, respond with a short summary."

            logger.info("[codex] agentic loop round %d: follow-up after %s", _round + 1, tool_name)
            current_result = await run_codex(
                prompt=followup_prompt,
                system_prompt=system_prompt,
                model=codex_model,
            )
            if current_result.error:
                yield f"data: {json.dumps({'content': f'Follow-up error: {current_result.error}'})}\n\n"
                break
            continue
        else:
            # Text response — model is done
            final_text = current_result.text or ""
            if final_text:
                yield f"data: {json.dumps({'content': final_text})}\n\n"
            break

    # Save conversation
    tool_names_str = ", ".join(all_tool_names) if all_tool_names else None
    # Save all tool results as array if multi-tool, single dict if one tool
    save_data = all_tool_results if len(all_tool_results) > 1 else last_tool_result
    _save_conversation(db, workspace, mode, last_user_message or user_message, final_text or "(empty)", tool_names_str, result.usage, tool_result_data=save_data)

    # Include response metadata
    yield f"data: {json.dumps({'meta': {'provider': 'codex', 'thread_id': result.thread_id, 'usage': result.usage}})}\n\n"
    yield "data: [DONE]\n\n"


def _save_conversation(db: Session, workspace, mode: str, user_msg: str, assistant_msg: str, tool_name: str | None, usage: dict, tool_result_data: dict | None = None):
    """Save the conversation turn to the database."""
    try:
        from sqlalchemy import text as sql_text

        # Save user message
        db.execute(sql_text(
            "INSERT INTO conversations (workspace_id, mode, role, content, created_at) VALUES (:wid, :mode, 'user', :content, clock_timestamp())"
        ), {"wid": str(workspace.id), "mode": mode, "content": user_msg})

        # Save assistant response
        db.execute(sql_text(
            "INSERT INTO conversations (workspace_id, mode, role, content, tool_name, tool_result, response_meta, created_at) VALUES (:wid, :mode, 'assistant', :content, :tool, :tool_result, :meta, clock_timestamp())"
        ), {
            "wid": str(workspace.id),
            "mode": mode,
            "content": assistant_msg or "(empty)",
            "tool": tool_name,
            "tool_result": json.dumps(tool_result_data) if tool_result_data else None,
            "meta": json.dumps({"usage": usage, "provider": "codex", "tool_names": [tool_name] if tool_name else []}),
        })
        db.commit()
    except Exception as e:
        logger.warning("[codex] Failed to save conversation: %s", e)
