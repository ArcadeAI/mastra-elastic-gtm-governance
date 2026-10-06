"""The toolkit against a fake Elasticsearch, and against the names the repo pins.

The fake is an `httpx.MockTransport`: every request the tools make lands in
`FakeElasticsearch.handle`, which records it and answers the way Elasticsearch
answers. The assertions are on what was sent and on the shape returned, because
both are contracts: what was sent is the Elasticsearch feature the workshop
names, and the shape is what `/hooks/post` masks.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from arcade_core.errors import ToolExecutionError
from arcade_core.schema import ToolContext, ToolSecretItem

from deal_desk import app
from deal_desk import elasticsearch as es
from tests import tools_of

REPO_ROOT = Path(__file__).resolve().parents[3]
URL = "https://deal-desk.es.example.elastic.cloud:443"
KEY = "encoded-api-key"


class FakeElasticsearch:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.routes: list[tuple[str, str, int, Any]] = []

    def on(self, method: str, pattern: str, body: Any, status: int = 200) -> None:
        self.routes.append((method, pattern, status, body))

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        for method, pattern, status, body in self.routes:
            if request.method == method and re.fullmatch(pattern, request.url.path):
                return httpx.Response(status, json=body)
        return httpx.Response(404, json={"error": {"type": "no_route", "reason": request.url.path}})

    def last_json(self) -> Any:
        return json.loads(self.requests[-1].content)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeElasticsearch:
    server = FakeElasticsearch()
    monkeypatch.setattr(es, "transport", httpx.MockTransport(server.handle))
    return server


@pytest.fixture
def context() -> ToolContext:
    return ToolContext(
        secrets=[
            ToolSecretItem(key="ELASTICSEARCH_URL", value=URL),
            ToolSecretItem(key="ELASTICSEARCH_API_KEY", value=KEY),
        ],
        user_id="michael@example.com",
    )


def a_search_response(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "hits": {
            "total": {"value": 1, "relation": "eq"},
            "hits": [{"_index": "deal-files", "_id": "DL-2291", "_score": 4.2, "_source": source}],
        }
    }


DOC = {
    "deal_id": "DL-2291",
    "account_name": "Northwind Robotics",
    "bank_account_number": "000123456789",
    "tax_id": "12-3456789",
    "crm_notes": "procurement wants a three-year prepay",
}


CATALOG = tools_of(es)


class TestTheNamesTheRepoPins:
    def test_the_server_files_itself_as_DealDesk(self) -> None:
        # One server for every tool: `deal_desk` PascalCased is the prefix of
        # every wire name, the 26 Elasticsearch tools included.
        assert app.name == "deal_desk"

    def test_exactly_the_26_tools_setup_arcade_puts_on_the_gateway(self) -> None:
        source = (REPO_ROOT / "scripts" / "setup-arcade" / "arcade.ts").read_text(encoding="utf-8")
        listed = re.search(r"export const ELASTIC_TOOLS = \[([^\]]*)\]", source)
        assert listed is not None
        pinned = sorted(re.findall(r'"([A-Za-z]+)"', listed.group(1)))
        assert sorted(tool.definition.name for tool in CATALOG) == pinned

    def test_every_argument_the_governance_catalogue_records(self) -> None:
        fixture = json.loads(
            (REPO_ROOT / "lib" / "control-plane" / "fixtures" / "governance.json").read_text(encoding="utf-8")
        )
        catalogue = fixture["catalogue"]["$TOOLKIT"]
        for tool in CATALOG:
            want = sorted(arg.rstrip("?") for arg in catalogue[tool.definition.name])
            have = sorted(param.name for param in tool.definition.input.parameters)
            assert have == want, tool.definition.name

    def test_every_tool_reads_the_two_secrets_and_needs_no_user_authorization(self) -> None:
        for tool in CATALOG:
            secrets = sorted(secret.key for secret in tool.definition.requirements.secrets or [])
            assert secrets == ["ELASTICSEARCH_API_KEY", "ELASTICSEARCH_URL"], tool.definition.name
            assert tool.definition.requirements.authorization is None, tool.definition.name


class TestTheOutputShapesTheHooksMask:
    async def test_search_hits_carry_the_document_at_hits_source(self, fake, context) -> None:
        fake.on("POST", "/deal-files/_search", a_search_response(DOC))
        result = await es.semantic_search(context, index="deal-files", field="crm_notes_semantic", query_text="single team")
        assert result["hits"][0]["source"]["tax_id"] == "12-3456789"
        assert result["hits"][0]["id"] == "DL-2291"
        assert result["total_hits"] == 1 and result["returned_hits"] == 1

    async def test_a_fetched_document_is_at_source(self, fake, context) -> None:
        fake.on("GET", "/deal-files/_doc/DL-2291", {"_id": "DL-2291", "found": True, "_source": DOC})
        result = await es.get_document(context, index="deal-files", document_id="DL-2291")
        assert result == {"index": "deal-files", "id": "DL-2291", "found": True, "source": DOC}

    async def test_a_missing_document_is_found_false_not_an_error(self, fake, context) -> None:
        fake.on("GET", "/deal-files/_doc/DL-0000", {"_id": "DL-0000", "found": False}, status=404)
        result = await es.get_document(context, index="deal-files", document_id="DL-0000")
        assert result["found"] is False


class TestTheElasticsearchFeaturesEachToolUses:
    async def test_semantic_search_is_a_semantic_query(self, fake, context) -> None:
        fake.on("POST", "/deal-files/_search", a_search_response(DOC))
        await es.semantic_search(context, index="deal-files", field="crm_notes_semantic", query_text="single team")
        assert fake.last_json()["query"] == {"semantic": {"field": "crm_notes_semantic", "query": "single team"}}

    async def test_hybrid_search_fuses_keyword_and_semantic_with_rrf(self, fake, context) -> None:
        fake.on("POST", "/deal-files/_search", a_search_response(DOC))
        await es.hybrid_search(
            context, index="deal-files", query_text="single team", semantic_field="crm_notes_semantic",
            text_fields=["crm_notes"],
        )
        rrf = fake.last_json()["retriever"]["rrf"]
        keyword, meaning = (r["standard"]["query"] for r in rrf["retrievers"])
        assert keyword["multi_match"]["fields"] == ["crm_notes"]
        assert meaning == {"semantic": {"field": "crm_notes_semantic", "query": "single team"}}

    async def test_keyword_search_with_no_fields_searches_the_text_fields_only(self, fake, context) -> None:
        mapping = {"deal-files": {"mappings": {"properties": {
            "account_name": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
            "crm_notes": {"type": "text", "copy_to": "crm_notes_semantic"},
            "crm_notes_semantic": {"type": "semantic_text"},
            "status": {"type": "keyword"},
        }}}}
        fake.on("GET", "/deal-files/_mapping", mapping)
        fake.on("POST", "/deal-files/_search", a_search_response(DOC))
        await es.search_by_text(context, index="deal-files", query_text="procurement")
        assert fake.last_json()["query"]["multi_match"]["fields"] == ["account_name", "crm_notes"]

    async def test_esql_rows_come_back_as_named_columns(self, fake, context) -> None:
        fake.on("POST", "/_query", {
            "columns": [{"name": "total", "type": "long"}, {"name": "status", "type": "keyword"}],
            "values": [[95000, "pending"], [40000, "approved"]],
        })
        result = await es.run_esql_query(context, query="FROM deal-files | STATS total = SUM(amount) BY status")
        assert result["rows"] == [{"total": 95000, "status": "pending"}, {"total": 40000, "status": "approved"}]
        assert fake.last_json() == {"query": "FROM deal-files | STATS total = SUM(amount) BY status"}

    async def test_bulk_is_one_ndjson_request_and_ids_come_from__id(self, fake, context) -> None:
        fake.on("POST", "/_bulk", {"errors": False, "items": [
            {"index": {"_id": "DL-2291", "status": 201}}, {"index": {"_id": "DL-2292", "status": 201}},
        ]})
        docs = [{"_id": "DL-2291", "amount": 95000}, {"_id": "DL-2292", "amount": 40000}]
        result = await es.bulk_index_documents(context, index="deal-files", documents=json.dumps(docs), refresh=True)
        assert result == {"index": "deal-files", "indexed": 2, "failed": 0, "errors": []}
        request = fake.requests[-1]
        assert request.headers["content-type"] == "application/x-ndjson"
        assert request.url.params["refresh"] == "true"
        lines = [json.loads(line) for line in request.content.decode().strip().split("\n")]
        assert lines[0] == {"index": {"_index": "deal-files", "_id": "DL-2291"}}
        assert lines[1] == {"amount": 95000}

    async def test_the_api_key_goes_in_the_ApiKey_header(self, fake, context) -> None:
        fake.on("POST", "/deal-files/_count", {"count": 8})
        result = await es.count_documents(context, index="deal-files")
        assert result == {"index": "deal-files", "count": 8}
        assert fake.requests[-1].headers["authorization"] == f"ApiKey {KEY}"


class TestErrorsAndGuards:
    async def test_elasticsearch_errors_are_passed_through_in_its_own_words(self, fake, context) -> None:
        fake.on("PUT", "/deal-files", {"error": {
            "type": "resource_already_exists_exception", "reason": "index [deal-files/abc] already exists",
        }, "status": 400}, status=400)
        with pytest.raises(ToolExecutionError, match="resource_already_exists_exception: index .* already exists"):
            await es.create_index(context, index="deal-files", mappings=json.dumps({"properties": {}}))

    async def test_a_serverless_only_refusal_is_reported_not_swallowed(self, fake, context) -> None:
        fake.on("GET", "/_cluster/health", {"error": {
            "type": "api_not_available_exception",
            "reason": "Request for uri [/_cluster/health] with method [GET] exists but is not available when running in serverless mode",
        }, "status": 410}, status=410)
        with pytest.raises(ToolExecutionError, match="not available when running in serverless mode"):
            await es.get_cluster_health(context)

    @pytest.mark.parametrize("index", ["*", "deal-*", "deal-files,other", "_all"])
    async def test_delete_index_refuses_anything_but_one_index(self, fake, context, index: str) -> None:
        with pytest.raises(ToolExecutionError, match="more than one index"):
            await es.delete_index(context, index=index)
        assert fake.requests == []

    async def test_system_indices_are_off_unless_asked_for(self, fake, context) -> None:
        with pytest.raises(ToolExecutionError, match="system or hidden index"):
            await es.search_by_text(context, index=".security", query_text="x", fields=["x"])
        with pytest.raises(ToolExecutionError, match="system or hidden index"):
            await es.run_esql_query(context, query="FROM .kibana | LIMIT 1")
        assert fake.requests == []

    async def test_invalid_json_arguments_say_which_argument(self, fake, context) -> None:
        with pytest.raises(ToolExecutionError, match="aggregations is not valid JSON"):
            await es.aggregate_documents(context, index="deal-files", aggregations="{not json")
