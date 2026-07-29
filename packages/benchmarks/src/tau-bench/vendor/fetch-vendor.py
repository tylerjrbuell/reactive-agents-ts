#!/usr/bin/env python3
"""Vendor tau-bench task definitions, domain policies and tool schemas VERBATIM.

Run: python3 packages/benchmarks/src/tau-bench/vendor/fetch-vendor.py

tau-bench's value to this repo is that it is THIRD-PARTY. A reimplemented task
set is a self-built bench wearing a borrowed name, which this project has
already ruled out as a basis for public claims. So nothing here authors task
content: every field is copied out of upstream's own source at a pinned commit.

Upstream stores its tasks as Python literals (`tasks_test.py` builds a list of
pydantic `Task(...)` objects) rather than JSON, so the one transform this script
performs is a MECHANICAL literal -> JSON dump. It does that by evaluating the
upstream module with `Task`/`Action` bound to plain dict constructors: no field
is renamed, defaulted, filtered or reordered. Same for tool schemas, which are
lifted out of each tool class's `get_info()` return literal via `ast`.

The multi-megabyte domain databases (orders/products/users/flights/reservations,
~7.3 MB) are NOT committed. Their SHA-256s are pinned in data-checksums.txt and
this script fetches them into `vendor/data/` on demand, so a checkout stays small
while the bytes an eventual run consumes are still pinned and verifiable.
"""

from __future__ import annotations

import ast
import hashlib
import json
import pathlib
import urllib.request

# Pinned upstream revision. Bumping this is a deliberate act: re-run the script,
# diff the JSON, and say so in the report that cites the score.
REPO = "sierra-research/tau-bench"
SHA = "59a200c6d575d595120f1cb70fea53cef0632f6b"  # main @ 2026-03-18
RAW = f"https://raw.githubusercontent.com/{REPO}/{SHA}"

HERE = pathlib.Path(__file__).parent
DOMAINS = {
    "retail": [
        "calculate",
        "cancel_pending_order",
        "exchange_delivered_order_items",
        "find_user_id_by_email",
        "find_user_id_by_name_zip",
        "get_order_details",
        "get_product_details",
        "get_user_details",
        "list_all_product_types",
        "modify_pending_order_address",
        "modify_pending_order_items",
        "modify_pending_order_payment",
        "modify_user_address",
        "return_delivered_order_items",
        "think",
        "transfer_to_human_agents",
    ],
    "airline": [
        "book_reservation",
        "calculate",
        "cancel_reservation",
        "get_reservation_details",
        "get_user_details",
        "list_all_airports",
        "search_direct_flight",
        "search_onestop_flight",
        "send_certificate",
        "think",
        "transfer_to_human_agents",
        "update_reservation_baggages",
        "update_reservation_flights",
        "update_reservation_passengers",
    ],
}
DATA_FILES = {
    "retail": ["orders.json", "products.json", "users.json"],
    "airline": ["flights.json", "reservations.json", "users.json"],
}


def fetch(path: str) -> bytes:
    with urllib.request.urlopen(f"{RAW}/{path}", timeout=120) as response:
        return response.read()


def convert_tasks(source: bytes) -> list[dict[str, object]]:
    """Evaluate upstream's task literal with dict-returning Task/Action stubs.

    No field is touched. `annotator` rides along on retail tasks even though
    upstream's pydantic model drops it -- dropping it here would be this file
    editorialising about upstream's data, which is the thing to avoid.
    """
    text = source.decode("utf-8")
    # Strip the pydantic import; the stubs below stand in for it.
    text = "\n".join(
        line for line in text.splitlines() if not line.startswith("from tau_bench")
    )
    namespace: dict[str, object] = {
        "Task": lambda **kwargs: dict(kwargs),
        "Action": lambda **kwargs: dict(kwargs),
    }
    exec(compile(text, "tasks_test.py", "exec"), namespace)  # noqa: S102
    for key in ("TASKS_TEST", "TASKS", "TASKS_DEV", "TASKS_TRAIN"):
        if key in namespace:
            tasks = namespace[key]
            assert isinstance(tasks, list)
            return tasks
    raise SystemExit("no task list found in upstream module")


def extract_tool_schema(source: bytes) -> dict[str, object]:
    """Lift the literal returned by a tool class's `get_info()` staticmethod."""
    tree = ast.parse(source.decode("utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "get_info":
            for statement in ast.walk(node):
                if isinstance(statement, ast.Return) and statement.value is not None:
                    schema = ast.literal_eval(statement.value)
                    assert isinstance(schema, dict)
                    return schema
    raise SystemExit("no get_info() literal found")


def main() -> None:
    (HERE / "LICENSE").write_bytes(fetch("LICENSE"))

    checksums: list[str] = []
    for domain, tools in DOMAINS.items():
        out = HERE / domain
        out.mkdir(exist_ok=True)

        # Domain policy, verbatim markdown -- this is the system prompt upstream
        # hands the agent, and the thing the simulated user holds it to.
        (out / "wiki.md").write_bytes(fetch(f"tau_bench/envs/{domain}/wiki.md"))

        tasks = convert_tasks(fetch(f"tau_bench/envs/{domain}/tasks_test.py"))
        (out / "tasks-test.json").write_text(
            json.dumps(tasks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        schemas = [
            extract_tool_schema(fetch(f"tau_bench/envs/{domain}/tools/{tool}.py"))
            for tool in tools
        ]
        (out / "tools.json").write_text(
            json.dumps(schemas, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"{domain}: {len(tasks)} tasks, {len(schemas)} tool schemas")

        for name in DATA_FILES[domain]:
            path = f"tau_bench/envs/{domain}/data/{name}"
            payload = fetch(path)
            checksums.append(f"{hashlib.sha256(payload).hexdigest()}  {path}")
            target = HERE / "data" / domain / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)

    (HERE / "data-checksums.txt").write_text(
        f"# {REPO} @ {SHA}\n"
        "# Domain databases are fetched, not committed (~7.3 MB). Verify with:\n"
        "#   sha256sum -c --ignore-missing data-checksums.txt\n" + "\n".join(checksums) + "\n",
        encoding="utf-8",
    )
    print("wrote data-checksums.txt")


if __name__ == "__main__":
    main()
