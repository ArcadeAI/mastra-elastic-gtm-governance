"""The Elasticsearch toolkit: the deal index, searchable, through the gateway.

A Python `arcade-mcp` toolkit, like its siblings `tools/loan` and
`tools/approvals`, shipped with `arcade deploy`. It exists because the module
it serves (`docs/ELASTIC.md`) was written against an Arcade Elasticsearch
toolkit that a project cannot add from the catalog; this is that toolkit's
contract, rebuilt from what the repo pins:

- **The names.** `MCPApp(name="Elasticsearch")` is PascalCased by Arcade into
  the toolkit name, and each snake_case function into a tool name, so these
  are `Elasticsearch.SearchByText`, `Elasticsearch_SearchByText` on the wire,
  and so on: exactly the 26 in `lib/control-plane/fixtures/governance.json`'s
  `$ELASTIC` catalogue and `scripts/setup-arcade/arcade.ts`'s `ELASTIC_TOOLS`.
  A rule keyed on a name this file does not serve matches nothing.
- **The arguments.** Each tool takes the argument list the catalogue records,
  under the same names. `/hooks/pre` reads `query` on `RunEsqlQuery` and
  `aggregations` on `AggregateDocuments` as strings, so structured arguments
  (`query`, `aggregations`, `mappings`, `documents`, …) are JSON strings.
- **The output shapes.** `/hooks/post` masks `hits[].source.<field>` on every
  search tool and `source.<field>` on `GetDocument`, so search results are
  `{index, total_hits, returned_hits, hits: [{id, score, source}]}` and a
  fetched document is `{index, id, found, source}`.
  `app-test/control-plane/elastic-post.test.ts` pins both.

It holds no policy. Who may see a write tool, which fields are masked, which
ES|QL is refused: all of it is the control plane's, decided before or after
this code runs. The two guards here (system indices off by default, no
wildcard on `DeleteIndex`) are the toolkit refusing to be a footgun, not
governance.

It talks to Elasticsearch over its REST API with the two secrets below, and
nothing else. On Elasticsearch Serverless the cluster-level APIs
(`_cluster/*`, `_cat/shards`, index stats) do not exist, so `GetClusterHealth`,
`GetShards` and `GetIndexStats` answer with Elasticsearch's own error there;
they are kept so the catalogue stays the catalogue.
"""

import json
import re
from typing import Annotated, Any
from urllib.parse import quote

import httpx
from arcade_core.errors import ToolExecutionError
from arcade_mcp_server import Context, MCPApp
from arcade_mcp_server.metadata import Behavior, Operation, ToolMetadata

ELASTICSEARCH_URL_SECRET = "ELASTICSEARCH_URL"
ELASTICSEARCH_API_KEY_SECRET = "ELASTICSEARCH_API_KEY"

app = MCPApp(
    name="Elasticsearch",
    version="1.0.0",
    instructions=(
        "Elasticsearch: list indices and read mappings; search by keyword, by meaning "
        "(semantic_text), by vector or both at once (hybrid); aggregate; count; fetch a "
        "document; run ES|QL; and write, update or delete documents and indices."
    ),
)

_secrets = [ELASTICSEARCH_URL_SECRET, ELASTICSEARCH_API_KEY_SECRET]

_read = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.READ], read_only=True, destructive=False, idempotent=True,
        open_world=False,
    ),
)
_create = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.CREATE], read_only=False, destructive=False, idempotent=False,
        open_world=False,
    ),
)
_update = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.UPDATE], read_only=False, destructive=False, idempotent=True,
        open_world=False,
    ),
)
_delete = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.DELETE], read_only=False, destructive=True, idempotent=True,
        open_world=False,
    ),
)

DEFAULT_SIZE = 10
MAX_SIZE = 100

# Tests swap this for an `httpx.MockTransport`; in production it is None and
# httpx opens real connections.
transport: httpx.AsyncBaseTransport | None = None


# --- Talking to Elasticsearch -------------------------------------------------


def _describe(status: int, body: Any) -> str:
    """Elasticsearch's own error, in one line: type and reason, as it said them."""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            kind = error.get("type", "error")
            reason = error.get("reason") or ""
            causes = error.get("root_cause") or []
            if not reason and causes and isinstance(causes[0], dict):
                reason = causes[0].get("reason") or ""
            return f"Elasticsearch answered {status}: {kind}: {reason}".rstrip(": ")
        if isinstance(error, str):
            return f"Elasticsearch answered {status}: {error}"
    return f"Elasticsearch answered {status}: {str(body)[:500]}"


async def _es(
    context: Context,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: Any = None,
    ndjson: str | None = None,
    allow: tuple[int, ...] = (),
) -> tuple[int, Any]:
    """One REST call with the project's API key. Raises on an error status not in `allow`."""
    url = context.get_secret(ELASTICSEARCH_URL_SECRET).strip().rstrip("/")
    key = context.get_secret(ELASTICSEARCH_API_KEY_SECRET).strip()
    headers = {"authorization": f"ApiKey {key}", "accept": "application/json"}
    clean = {k: _param(v) for k, v in (params or {}).items() if v is not None}
    request: dict[str, Any] = {"params": clean, "headers": headers}
    if ndjson is not None:
        headers["content-type"] = "application/x-ndjson"
        request["content"] = ndjson.encode()
    elif body is not None:
        request["json"] = body
    try:
        async with httpx.AsyncClient(base_url=url, timeout=60.0, transport=transport) as client:
            response = await client.request(method, path, **request)
    except httpx.HTTPError as exc:
        raise ToolExecutionError(
            "Elasticsearch could not be reached. Check ELASTICSEARCH_URL in the Arcade "
            "project's secrets: it is the Elasticsearch endpoint, not the Kibana URL.",
            developer_message=f"{type(exc).__name__}: {exc}",
        ) from exc
    try:
        payload: Any = response.json()
    except ValueError:
        payload = response.text
    if response.status_code >= 400 and response.status_code not in allow:
        raise ToolExecutionError(
            _describe(response.status_code, payload),
            developer_message=f"{method} {path} -> {response.status_code}",
        )
    return response.status_code, payload


def _param(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _path(*parts: str) -> str:
    return "/" + "/".join(quote(part, safe=",*") for part in parts)


# --- Arguments ------------------------------------------------------------------


def _json(name: str, value: Any) -> Any:
    """A structured argument, given as JSON text (or already parsed)."""
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError as exc:
        raise ToolExecutionError(
            f"{name} is not valid JSON: {exc.msg} at position {exc.pos}.",
            developer_message=f"{name}={value[:200]!r}",
        ) from exc


def _guard_system(index: str, include_system_indices: bool) -> None:
    """System and hidden indices (names starting with a dot) are off unless asked for."""
    if include_system_indices:
        return
    for part in index.split(","):
        if part.strip().lstrip("-").startswith("."):
            raise ToolExecutionError(
                f"{part.strip()!r} is a system or hidden index. Pass "
                "include_system_indices=true to read it on purpose."
            )


def _size(size: int | None) -> int:
    if size is None:
        return DEFAULT_SIZE
    return max(0, min(int(size), MAX_SIZE))


def _offset(offset: int | None, cursor: str | None) -> int:
    if cursor:
        try:
            return max(0, int(cursor))
        except ValueError as exc:
            raise ToolExecutionError(
                f"cursor {cursor!r} is not one this toolkit issued; pass the next_cursor "
                "from the previous page, or use offset."
            ) from exc
    return max(0, int(offset or 0))


def _with_filter(query: dict[str, Any], filter_query: str | None) -> dict[str, Any]:
    clause = _json("filter_query", filter_query)
    if clause is None:
        return query
    return {"bool": {"must": [query], "filter": [clause]}}


def _hits(index: str, payload: dict[str, Any], offset: int) -> dict[str, Any]:
    """The search-result shape `/hooks/post` masks at `hits[].source.*`."""
    block = payload.get("hits") or {}
    total = block.get("total")
    total_hits = total.get("value") if isinstance(total, dict) else total
    hits = []
    for hit in block.get("hits") or []:
        source = dict(hit.get("_source") or {})
        source.pop("_inference_fields", None)
        entry: dict[str, Any] = {"id": hit.get("_id"), "score": hit.get("_score"), "source": source}
        if hit.get("_index") and hit["_index"] != index:
            entry["index"] = hit["_index"]
        if "highlight" in hit:
            entry["highlight"] = hit["highlight"]
        hits.append(entry)
    result: dict[str, Any] = {
        "index": index,
        "total_hits": total_hits,
        "returned_hits": len(hits),
        "hits": hits,
    }
    if isinstance(total_hits, int) and offset + len(hits) < total_hits and hits:
        result["next_cursor"] = str(offset + len(hits))
    return result


async def _text_fields(context: Context, index: str) -> list[str]:
    """The index's `text` fields, which is what a keyword search with no `fields` searches."""
    _, mappings = await _es(context, "GET", _path(index, "_mapping"))
    found: list[str] = []

    def walk(properties: dict[str, Any], prefix: str) -> None:
        for name, spec in properties.items():
            if not isinstance(spec, dict):
                continue
            full = f"{prefix}{name}"
            if spec.get("type") == "text":
                found.append(full)
            if isinstance(spec.get("properties"), dict):
                walk(spec["properties"], f"{full}.")

    for body in (mappings or {}).values():
        walk(((body or {}).get("mappings") or {}).get("properties") or {}, "")
    return sorted(set(found)) or ["*"]


# --- Cluster and index metadata -------------------------------------------------


@app.tool(requires_secrets=_secrets, metadata=_read)
async def who_am_i(
    context: Context,
) -> Annotated[dict[str, Any], "The authenticated principal and the cluster it is connected to."]:
    """Shows which Elasticsearch identity the toolkit's API key authenticates as, and which cluster and version it reaches."""
    _, me = await _es(context, "GET", "/_security/_authenticate")
    _, info = await _es(context, "GET", "/")
    api_key = me.get("api_key") or {}
    version = info.get("version") or {}
    return {
        "username": me.get("username"),
        "authentication_type": me.get("authentication_type"),
        "api_key_name": api_key.get("name"),
        "cluster_name": info.get("cluster_name"),
        "version": version.get("number"),
        "build_flavor": version.get("build_flavor"),
    }


@app.tool(requires_secrets=_secrets, metadata=_read)
async def list_indices(
    context: Context,
    index_pattern: Annotated[str | None, "Index name or wildcard pattern. Defaults to every index."] = None,
    include_system_indices: Annotated[bool, "Include system and hidden indices (names starting with a dot)."] = False,
) -> Annotated[dict[str, Any], "The matching indices with their document counts and size."]:
    """Lists indices, with document count and store size for each."""
    pattern = index_pattern or "*"
    _guard_system(pattern, include_system_indices)
    params = {"format": "json", "expand_wildcards": "all" if include_system_indices else "open"}
    _, rows = await _es(context, "GET", _path("_cat", "indices", pattern), params=params)
    indices = [
        row for row in rows or []
        if include_system_indices or not str(row.get("index", "")).startswith(".")
    ]
    return {"indices": sorted(indices, key=lambda row: str(row.get("index")))}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def get_index_mapping(
    context: Context,
    index: Annotated[str, "The index name."],
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The index's field mappings: field names and their types."]:
    """Returns an index's mapping: every field and its type (text, keyword, long, date, semantic_text, …). Read this before searching an unfamiliar index."""
    _guard_system(index, include_system_indices)
    _, mappings = await _es(context, "GET", _path(index, "_mapping"))
    return {"index": index, "mappings": {name: body.get("mappings") for name, body in (mappings or {}).items()}}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def list_aliases(
    context: Context,
    alias_pattern: Annotated[str | None, "Alias name or wildcard pattern. Defaults to every alias."] = None,
    include_system_indices: Annotated[bool, "Include aliases on system and hidden indices."] = False,
) -> Annotated[dict[str, Any], "The matching aliases and the indices they point to."]:
    """Lists index aliases and the indices each points to."""
    parts = ["_cat", "aliases"] + ([alias_pattern] if alias_pattern else [])
    _, rows = await _es(context, "GET", _path(*parts), params={"format": "json"})
    aliases = [
        row for row in rows or []
        if include_system_indices
        or not (str(row.get("alias", "")).startswith(".") or str(row.get("index", "")).startswith("."))
    ]
    return {"aliases": aliases}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def list_inference_endpoints(
    context: Context,
    task_type: Annotated[str | None, "Only endpoints of this task type: text_embedding, sparse_embedding, rerank, completion, chat_completion."] = None,
    dimensions: Annotated[int | None, "Only dense embedding endpoints with this many dimensions."] = None,
    usable_now: Annotated[bool, "Accepted for compatibility; every endpoint listed is one the cluster reports as configured."] = False,
) -> Annotated[dict[str, Any], "The inference endpoints: id, task type, service and model."]:
    """Lists the cluster's inference endpoints, the models semantic_text fields and vector search embed with (on Serverless, Jina and ELSER on the Elastic Inference Service)."""
    path = _path("_inference", task_type, "_all") if task_type else "/_inference/_all"
    _, body = await _es(context, "GET", path)
    endpoints = []
    for endpoint in (body or {}).get("endpoints") or []:
        settings = endpoint.get("service_settings") or {}
        if dimensions is not None and settings.get("dimensions") != dimensions:
            continue
        endpoints.append({
            "inference_id": endpoint.get("inference_id"),
            "task_type": endpoint.get("task_type"),
            "service": endpoint.get("service"),
            "model_id": settings.get("model_id"),
            "dimensions": settings.get("dimensions"),
        })
    return {"endpoints": endpoints}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def get_cluster_health(
    context: Context,
) -> Annotated[dict[str, Any], "Cluster health: status, nodes and shard counts."]:
    """Returns cluster health. Not available on Elasticsearch Serverless, where Elastic manages the cluster."""
    _, body = await _es(context, "GET", "/_cluster/health")
    return body


@app.tool(requires_secrets=_secrets, metadata=_read)
async def get_index_stats(
    context: Context,
    index: Annotated[str, "The index name."],
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "Index statistics: document counts, store size, indexing and search totals."]:
    """Returns an index's statistics. Not available on Elasticsearch Serverless."""
    _guard_system(index, include_system_indices)
    _, body = await _es(context, "GET", _path(index, "_stats"))
    return {"index": index, "stats": (body or {}).get("_all")}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def get_shards(
    context: Context,
    index: Annotated[str | None, "The index name. Defaults to every index."] = None,
    include_system_indices: Annotated[bool, "Include system and hidden indices."] = False,
) -> Annotated[dict[str, Any], "Shard allocation: index, shard, primary or replica, state and node."]:
    """Lists shards and where they are allocated. Not available on Elasticsearch Serverless, where Elastic manages sharding."""
    if index:
        _guard_system(index, include_system_indices)
    parts = ["_cat", "shards"] + ([index] if index else [])
    _, rows = await _es(context, "GET", _path(*parts), params={"format": "json"})
    shards = [
        row for row in rows or []
        if include_system_indices or not str(row.get("index", "")).startswith(".")
    ]
    return {"shards": shards}


# --- Search ---------------------------------------------------------------------


@app.tool(requires_secrets=_secrets, metadata=_read)
async def search_by_text(
    context: Context,
    index: Annotated[str, "The index to search."],
    query_text: Annotated[str | None, "Words to search for (BM25 keyword relevance). Omit to list documents."] = None,
    fields: Annotated[list[str] | None, "Text fields to search. Defaults to every text field in the index."] = None,
    size: Annotated[int | None, "How many hits to return, at most 100. Default 10."] = None,
    offset: Annotated[int | None, "How many hits to skip, for paging."] = None,
    filter_query: Annotated[str | None, "A query DSL clause as JSON, applied as a filter, e.g. {\"term\": {\"status\": \"pending\"}}."] = None,
    source_fields: Annotated[list[str] | None, "Only return these fields of each document."] = None,
    highlight: Annotated[bool, "Return the matching passages with the words highlighted."] = False,
    cursor: Annotated[str | None, "next_cursor from a previous page."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "Hits ranked by keyword relevance: id, score and the document as source."]:
    """Keyword search: finds documents containing the words, ranked by BM25 relevance. Use it when the exact words matter; use SemanticSearch to search by meaning."""
    _guard_system(index, include_system_indices)
    start = _offset(offset, cursor)
    searched = fields or (await _text_fields(context, index) if query_text else [])
    base: dict[str, Any] = (
        {"multi_match": {"query": query_text, "fields": searched, "lenient": True}}
        if query_text else {"match_all": {}}
    )
    body: dict[str, Any] = {"query": _with_filter(base, filter_query), "from": start, "size": _size(size)}
    if source_fields:
        body["_source"] = source_fields
    if highlight and query_text:
        body["highlight"] = {"fields": {field: {} for field in searched}}
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    return _hits(index, payload, start)


@app.tool(requires_secrets=_secrets, metadata=_read)
async def semantic_search(
    context: Context,
    index: Annotated[str, "The index to search."],
    field: Annotated[str, "A semantic_text field, e.g. crm_notes_semantic."],
    query_text: Annotated[str, "What to look for, in plain language. Matched by meaning, not by words."],
    size: Annotated[int | None, "How many hits to return, at most 100. Default 10."] = None,
    offset: Annotated[int | None, "How many hits to skip, for paging."] = None,
    filter_query: Annotated[str | None, "A query DSL clause as JSON, applied as a filter."] = None,
    source_fields: Annotated[list[str] | None, "Only return these fields of each document."] = None,
    cursor: Annotated[str | None, "next_cursor from a previous page."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "Hits ranked by semantic similarity: id, score and the document as source."]:
    """Semantic search on a semantic_text field: finds documents that mean what the query means, even when they share no words with it. Elasticsearch embeds the query with the field's own inference endpoint."""
    _guard_system(index, include_system_indices)
    start = _offset(offset, cursor)
    base = {"semantic": {"field": field, "query": query_text}}
    body: dict[str, Any] = {"query": _with_filter(base, filter_query), "from": start, "size": _size(size)}
    if source_fields:
        body["_source"] = source_fields
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    return _hits(index, payload, start)


@app.tool(requires_secrets=_secrets, metadata=_read)
async def vector_search(
    context: Context,
    index: Annotated[str, "The index to search."],
    field: Annotated[str, "A dense_vector or semantic_text field."],
    query_text: Annotated[str | None, "Text to embed and search with. Give this or query_vector."] = None,
    inference_id: Annotated[str | None, "The inference endpoint that embeds query_text. Not needed for a semantic_text field."] = None,
    query_vector: Annotated[str | None, "The query vector as a JSON array of numbers. Give this or query_text."] = None,
    k: Annotated[int | None, "How many nearest neighbours to return, at most 100. Default 10."] = None,
    offset: Annotated[int | None, "How many hits to skip, for paging."] = None,
    num_candidates: Annotated[int | None, "Candidates considered per shard. Default max(50, 5k)."] = None,
    filter_query: Annotated[str | None, "A query DSL clause as JSON, applied as a pre-filter."] = None,
    source_fields: Annotated[list[str] | None, "Only return these fields of each document."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The k nearest documents: id, score and the document as source."]:
    """Approximate k-nearest-neighbour vector search. For plain-language questions over a semantic_text field, SemanticSearch is simpler."""
    _guard_system(index, include_system_indices)
    top = _size(k)
    start = _offset(offset, None)
    knn: dict[str, Any] = {"field": field, "k": top + start, "num_candidates": num_candidates or max(50, 5 * (top + start))}
    vector = _json("query_vector", query_vector)
    if vector is not None:
        knn["query_vector"] = vector
    elif query_text:
        builder: dict[str, Any] = {"model_text": query_text}
        if inference_id:
            builder["model_id"] = inference_id
        knn["query_vector_builder"] = {"text_embedding": builder}
    else:
        raise ToolExecutionError("Give query_text or query_vector.")
    clause = _json("filter_query", filter_query)
    if clause is not None:
        knn["filter"] = clause
    body: dict[str, Any] = {"knn": knn, "from": start, "size": top}
    if source_fields:
        body["_source"] = source_fields
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    return _hits(index, payload, start)


@app.tool(requires_secrets=_secrets, metadata=_read)
async def hybrid_search(
    context: Context,
    index: Annotated[str, "The index to search."],
    query_text: Annotated[str, "What to look for, in plain language."],
    semantic_field: Annotated[str, "The semantic_text field for the meaning half, e.g. crm_notes_semantic."],
    text_fields: Annotated[list[str] | None, "Text fields for the keyword half. Defaults to every text field."] = None,
    size: Annotated[int | None, "How many hits to return, at most 100. Default 10."] = None,
    offset: Annotated[int | None, "How many hits to skip, for paging."] = None,
    rank_window_size: Annotated[int | None, "How many hits from each half are fused. Default max(50, offset+size)."] = None,
    filter_query: Annotated[str | None, "A query DSL clause as JSON, applied to both halves as a filter."] = None,
    source_fields: Annotated[list[str] | None, "Only return these fields of each document."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "Hits ranked by fused keyword and semantic relevance: id, score and the document as source."]:
    """Hybrid search: runs a keyword (BM25) search and a semantic search together and fuses the two rankings with reciprocal rank fusion (RRF), so a document that matches the words or the meaning ranks well."""
    _guard_system(index, include_system_indices)
    start = _offset(offset, None)
    top = _size(size)
    fields = text_fields or await _text_fields(context, index)
    clause = _json("filter_query", filter_query)
    keyword: dict[str, Any] = {"query": {"multi_match": {"query": query_text, "fields": fields, "lenient": True}}}
    meaning: dict[str, Any] = {"query": {"semantic": {"field": semantic_field, "query": query_text}}}
    if clause is not None:
        keyword["filter"] = clause
        meaning["filter"] = clause
    body: dict[str, Any] = {
        "retriever": {
            "rrf": {
                "retrievers": [{"standard": keyword}, {"standard": meaning}],
                "rank_window_size": rank_window_size or max(50, start + top),
            }
        },
        "from": start,
        "size": top,
    }
    if source_fields:
        body["_source"] = source_fields
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    return _hits(index, payload, start)


@app.tool(requires_secrets=_secrets, metadata=_read)
async def search_documents(
    context: Context,
    index: Annotated[str, "The index to search."],
    query: Annotated[str | None, "A query DSL query as JSON, e.g. {\"range\": {\"amount\": {\"gte\": 50000}}}. Defaults to match_all."] = None,
    size: Annotated[int | None, "How many hits to return, at most 100. Default 10."] = None,
    offset: Annotated[int | None, "How many hits to skip, for paging."] = None,
    sort: Annotated[str | None, "Sort as JSON, e.g. [{\"requested_at\": \"desc\"}]."] = None,
    source_fields: Annotated[list[str] | None, "Only return these fields of each document."] = None,
    aggregations: Annotated[str | None, "Aggregations as JSON, returned alongside the hits."] = None,
    track_total_hits: Annotated[bool | None, "Count every match exactly rather than stopping at 10,000."] = None,
    cursor: Annotated[str | None, "next_cursor from a previous page."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "Hits for a query DSL search: id, score and the document as source, plus any aggregations."]:
    """Searches with a full Elasticsearch query DSL query, for filters, ranges and sorts the other search tools do not express."""
    _guard_system(index, include_system_indices)
    start = _offset(offset, cursor)
    body: dict[str, Any] = {"query": _json("query", query) or {"match_all": {}}, "from": start, "size": _size(size)}
    if (parsed_sort := _json("sort", sort)) is not None:
        body["sort"] = parsed_sort
    if source_fields:
        body["_source"] = source_fields
    if (aggs := _json("aggregations", aggregations)) is not None:
        body["aggs"] = aggs
    if track_total_hits is not None:
        body["track_total_hits"] = track_total_hits
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    result = _hits(index, payload, start)
    if "aggregations" in payload:
        result["aggregations"] = payload["aggregations"]
    return result


@app.tool(requires_secrets=_secrets, metadata=_read)
async def aggregate_documents(
    context: Context,
    index: Annotated[str, "The index to aggregate over."],
    aggregations: Annotated[str, "Aggregations as JSON, e.g. {\"by_status\": {\"terms\": {\"field\": \"status\"}, \"aggs\": {\"total\": {\"sum\": {\"field\": \"amount\"}}}}}."],
    query: Annotated[str | None, "A query DSL query as JSON restricting the documents aggregated."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The aggregation results: buckets and metrics, and how many documents they cover."]:
    """Runs Elasticsearch aggregations (terms, sum, avg, date_histogram, …) and returns only the results, no documents."""
    _guard_system(index, include_system_indices)
    aggs = _json("aggregations", aggregations)
    if not aggs:
        raise ToolExecutionError("aggregations is required: a JSON object of named aggregations.")
    body: dict[str, Any] = {"size": 0, "aggs": aggs, "track_total_hits": True}
    if (parsed := _json("query", query)) is not None:
        body["query"] = parsed
    _, payload = await _es(context, "POST", _path(index, "_search"), body=body)
    total = (payload.get("hits") or {}).get("total")
    return {
        "index": index,
        "total_hits": total.get("value") if isinstance(total, dict) else total,
        "aggregations": payload.get("aggregations") or {},
    }


@app.tool(requires_secrets=_secrets, metadata=_read)
async def count_documents(
    context: Context,
    index: Annotated[str, "The index to count."],
    query: Annotated[str | None, "A query DSL query as JSON. Defaults to every document."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The number of matching documents."]:
    """Counts the documents in an index, or those matching a query."""
    _guard_system(index, include_system_indices)
    parsed = _json("query", query)
    _, payload = await _es(
        context, "POST", _path(index, "_count"), body={"query": parsed} if parsed is not None else None
    )
    return {"index": index, "count": payload.get("count")}


@app.tool(requires_secrets=_secrets, metadata=_read)
async def get_document(
    context: Context,
    index: Annotated[str, "The index."],
    document_id: Annotated[str, "The document's id."],
    source_fields: Annotated[list[str] | None, "Only return these fields."] = None,
    include_system_indices: Annotated[bool, "Allow a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The document as source, or found=false."]:
    """Fetches one document by id."""
    _guard_system(index, include_system_indices)
    params = {"_source_includes": ",".join(source_fields)} if source_fields else None
    status, payload = await _es(context, "GET", _path(index, "_doc", document_id), params=params, allow=(404,))
    if status == 404 or not payload.get("found"):
        return {"index": index, "id": document_id, "found": False}
    source = dict(payload.get("_source") or {})
    source.pop("_inference_fields", None)
    return {"index": index, "id": payload.get("_id"), "found": True, "source": source}


_ESQL_SOURCE = re.compile(r"^\s*FROM\s+([^\s|]+)", re.IGNORECASE)


@app.tool(requires_secrets=_secrets, metadata=_read)
async def run_esql_query(
    context: Context,
    query: Annotated[str, "An ES|QL query, e.g. FROM deal-files | STATS total = SUM(amount) BY status. Use KEEP to name the columns you need."],
    include_system_indices: Annotated[bool, "Allow FROM on a system or hidden index."] = False,
) -> Annotated[dict[str, Any], "The result table: column names and one object per row."]:
    """Runs an ES|QL query (Elasticsearch's piped query language: FROM | WHERE | STATS … BY | SORT | KEEP | LIMIT) and returns the result as rows."""
    match = _ESQL_SOURCE.match(query)
    if match:
        _guard_system(match.group(1), include_system_indices)
    _, payload = await _es(context, "POST", "/_query", params={"format": "json"}, body={"query": query})
    columns = [column.get("name") for column in payload.get("columns") or []]
    rows = [dict(zip(columns, values)) for values in payload.get("values") or []]
    return {"columns": columns, "rows": rows, "row_count": len(rows)}


# --- Writes -----------------------------------------------------------------------


def _guard_write_target(index: str) -> None:
    if not index or any(mark in index for mark in ("*", "?", ",")) or index.strip() in ("_all", "-"):
        raise ToolExecutionError(
            f"{index!r} names more than one index. Writes and deletes take one concrete index name."
        )
    _guard_system(index, False)


def _concurrency(if_seq_no: int | None, if_primary_term: int | None) -> dict[str, Any]:
    return {"if_seq_no": if_seq_no, "if_primary_term": if_primary_term}


def _written(index: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": index,
        "id": payload.get("_id"),
        "result": payload.get("result"),
        "version": payload.get("_version"),
        "seq_no": payload.get("_seq_no"),
        "primary_term": payload.get("_primary_term"),
    }


@app.tool(requires_secrets=_secrets, metadata=_create)
async def index_document(
    context: Context,
    index: Annotated[str, "The index."],
    document: Annotated[str, "The document as a JSON object."],
    document_id: Annotated[str | None, "Its id. Omit to let Elasticsearch assign one; give an existing id to replace that document."] = None,
    if_seq_no: Annotated[int | None, "Only write if the document is at this sequence number (optimistic concurrency)."] = None,
    if_primary_term: Annotated[int | None, "Only write if the document is at this primary term."] = None,
    refresh: Annotated[bool, "Make the write visible to search immediately."] = False,
) -> Annotated[dict[str, Any], "The written document's id, result and version."]:
    """Writes one document to an index, creating or replacing it."""
    _guard_write_target(index)
    doc = _json("document", document)
    if not isinstance(doc, dict):
        raise ToolExecutionError("document must be a JSON object.")
    params = {"refresh": refresh, **_concurrency(if_seq_no, if_primary_term)}
    if document_id:
        _, payload = await _es(context, "PUT", _path(index, "_doc", document_id), params=params, body=doc)
    else:
        _, payload = await _es(context, "POST", _path(index, "_doc"), params=params, body=doc)
    return _written(index, payload)


@app.tool(requires_secrets=_secrets, metadata=_create)
async def bulk_index_documents(
    context: Context,
    index: Annotated[str, "The index."],
    documents: Annotated[str, "A JSON array of documents. A document's _id key, if present, becomes its id and is not stored."],
    refresh: Annotated[bool, "Make the writes visible to search immediately."] = False,
) -> Annotated[dict[str, Any], "How many documents were indexed and how many failed, with the first errors."]:
    """Writes many documents in one Bulk API request."""
    _guard_write_target(index)
    docs = _json("documents", documents)
    if not isinstance(docs, list) or not all(isinstance(doc, dict) for doc in docs):
        raise ToolExecutionError("documents must be a JSON array of objects.")
    if not docs:
        return {"index": index, "indexed": 0, "failed": 0, "errors": []}
    lines: list[str] = []
    for doc in docs:
        body = dict(doc)
        action: dict[str, Any] = {"_index": index}
        if "_id" in body:
            action["_id"] = str(body.pop("_id"))
        lines.append(json.dumps({"index": action}))
        lines.append(json.dumps(body))
    _, payload = await _es(
        context, "POST", "/_bulk", params={"refresh": refresh}, ndjson="\n".join(lines) + "\n"
    )
    errors = []
    indexed = 0
    for item in payload.get("items") or []:
        result = item.get("index") or {}
        if result.get("error"):
            error = result["error"]
            errors.append({"id": result.get("_id"), "type": error.get("type"), "reason": error.get("reason")})
        else:
            indexed += 1
    return {"index": index, "indexed": indexed, "failed": len(errors), "errors": errors[:20]}


@app.tool(requires_secrets=_secrets, metadata=_update)
async def update_document(
    context: Context,
    index: Annotated[str, "The index."],
    document_id: Annotated[str, "The document's id."],
    fields: Annotated[str, "The fields to change, as a JSON object. Fields not named are kept."],
    if_seq_no: Annotated[int | None, "Only update if the document is at this sequence number."] = None,
    if_primary_term: Annotated[int | None, "Only update if the document is at this primary term."] = None,
    upsert: Annotated[bool, "Create the document from fields if it does not exist."] = False,
    refresh: Annotated[bool, "Make the change visible to search immediately."] = False,
) -> Annotated[dict[str, Any], "The updated document's id, result and version."]:
    """Changes some fields of one document, keeping the rest."""
    _guard_write_target(index)
    doc = _json("fields", fields)
    if not isinstance(doc, dict) or not doc:
        raise ToolExecutionError("fields must be a non-empty JSON object.")
    params = {"refresh": refresh, **_concurrency(if_seq_no, if_primary_term)}
    _, payload = await _es(
        context, "POST", _path(index, "_update", document_id), params=params,
        body={"doc": doc, "doc_as_upsert": upsert},
    )
    return _written(index, payload)


@app.tool(requires_secrets=_secrets, metadata=_delete)
async def delete_document(
    context: Context,
    index: Annotated[str, "The index."],
    document_id: Annotated[str, "The document's id."],
    if_seq_no: Annotated[int | None, "Only delete if the document is at this sequence number."] = None,
    if_primary_term: Annotated[int | None, "Only delete if the document is at this primary term."] = None,
    refresh: Annotated[bool, "Make the deletion visible to search immediately."] = False,
) -> Annotated[dict[str, Any], "The deleted document's id and result (deleted or not_found)."]:
    """Deletes one document by id."""
    _guard_write_target(index)
    params = {"refresh": refresh, **_concurrency(if_seq_no, if_primary_term)}
    _, payload = await _es(context, "DELETE", _path(index, "_doc", document_id), params=params, allow=(404,))
    return _written(index, payload)


@app.tool(requires_secrets=_secrets, metadata=_delete)
async def delete_documents_by_query(
    context: Context,
    index: Annotated[str, "The index."],
    query: Annotated[str, "A query DSL query as JSON selecting the documents to delete. match_all is refused."],
    refresh: Annotated[bool, "Refresh the index afterwards."] = False,
) -> Annotated[dict[str, Any], "How many documents were deleted, and any failures."]:
    """Deletes every document matching a query."""
    _guard_write_target(index)
    parsed = _json("query", query)
    if not isinstance(parsed, dict) or not parsed or "match_all" in parsed:
        raise ToolExecutionError(
            "query must select documents. To empty an index, delete and recreate it instead."
        )
    _, payload = await _es(
        context, "POST", _path(index, "_delete_by_query"), params={"refresh": refresh}, body={"query": parsed}
    )
    return {
        "index": index,
        "deleted": payload.get("deleted"),
        "total": payload.get("total"),
        "failures": (payload.get("failures") or [])[:20],
    }


@app.tool(requires_secrets=_secrets, metadata=_create)
async def create_index(
    context: Context,
    index: Annotated[str, "The new index's name."],
    mappings: Annotated[str | None, "The mappings as JSON, e.g. {\"properties\": {\"notes\": {\"type\": \"semantic_text\"}}}."] = None,
    settings: Annotated[str | None, "Index settings as JSON. On Serverless, shard and replica counts are managed for you."] = None,
) -> Annotated[dict[str, Any], "Whether the index was created."]:
    """Creates an index, optionally with mappings and settings. A semantic_text field with no inference_id uses the cluster's default embedding model."""
    _guard_write_target(index)
    body: dict[str, Any] = {}
    if (parsed := _json("mappings", mappings)) is not None:
        body["mappings"] = parsed
    if (parsed := _json("settings", settings)) is not None:
        body["settings"] = parsed
    _, payload = await _es(context, "PUT", _path(index), body=body or None)
    return {"index": payload.get("index", index), "acknowledged": payload.get("acknowledged", False)}


@app.tool(requires_secrets=_secrets, metadata=_create)
async def reindex_documents(
    context: Context,
    source_index: Annotated[str, "The index to copy from."],
    destination_index: Annotated[str, "The index to copy into."],
    query: Annotated[str | None, "A query DSL query as JSON selecting which documents to copy."] = None,
    max_documents: Annotated[int | None, "Copy at most this many documents."] = None,
    refresh: Annotated[bool, "Refresh the destination afterwards."] = False,
) -> Annotated[dict[str, Any], "How many documents were created, updated and failed."]:
    """Copies documents from one index into another, for example after a mapping change."""
    _guard_system(source_index, False)
    _guard_write_target(destination_index)
    source: dict[str, Any] = {"index": source_index}
    if (parsed := _json("query", query)) is not None:
        source["query"] = parsed
    body: dict[str, Any] = {"source": source, "dest": {"index": destination_index}}
    if max_documents is not None:
        body["max_docs"] = max_documents
    _, payload = await _es(context, "POST", "/_reindex", params={"refresh": refresh}, body=body)
    return {
        "source_index": source_index,
        "destination_index": destination_index,
        "total": payload.get("total"),
        "created": payload.get("created"),
        "updated": payload.get("updated"),
        "failures": (payload.get("failures") or [])[:20],
    }


@app.tool(requires_secrets=_secrets, metadata=_delete)
async def delete_index(
    context: Context,
    index: Annotated[str, "The one index to delete. Wildcards and lists are refused."],
) -> Annotated[dict[str, Any], "Whether the index was deleted."]:
    """Deletes an index and every document in it. Irreversible."""
    _guard_write_target(index)
    _, payload = await _es(context, "DELETE", _path(index))
    return {"index": index, "acknowledged": payload.get("acknowledged", False)}


@app.tool(requires_secrets=_secrets, metadata=_update)
async def refresh_index(
    context: Context,
    index: Annotated[str, "The index."],
) -> Annotated[dict[str, Any], "Whether the refresh succeeded."]:
    """Makes every recent write to an index visible to search."""
    _guard_write_target(index)
    _, payload = await _es(context, "POST", _path(index, "_refresh"))
    shards = payload.get("_shards") or {}
    return {"index": index, "refreshed": not shards.get("failed")}
