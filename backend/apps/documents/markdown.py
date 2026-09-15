"""문서 본문(HTML) ↔ 마크다운 변환.

여기서 다루는 HTML 은 일반 웹 문서가 아니라 **우리 에디터가 찍어낸 것**이다. 태그 종류가
정해져 있어서 범용 변환 라이브러리 없이 표준 html.parser 만으로 충분하고, 오히려 그 편이
콜아웃·멘션·이슈 카드 같은 우리 고유 노드를 원하는 모양으로 내보낼 수 있다.

마크다운으로 무손실 표현이 안 되는 것의 처리 방침(사용자 합의):
  - 콜아웃 → Obsidian 콜아웃 문법 `> [!info]`
  - 문서 멘션 → Obsidian 위키링크 `[[제목]]` + 되돌리기용 메타 주석
  - 태그 멘션 → `#태그`
  - 이슈 카드/임베드 → 표시용 글자 + 바로 앞줄에 `<!--orbitail:issue ...-->` 메타 주석
    (다른 앱에서는 주석이라 안 보이고, 우리 쪽으로 되돌릴 때 원래 노드로 복원된다)
"""

from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser

VOID_TAGS = {"img", "br", "hr", "input", "col", "source"}

# 인라인 표시 → 마크다운 기호
INLINE_WRAP = {
    "strong": "**", "b": "**",
    "em": "*", "i": "*",
    "s": "~~", "del": "~~", "strike": "~~",
    "mark": "==",          # Obsidian 형광펜
    "code": "`",
}

BLOCK_TAGS = {
    "p", "div", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "table", "hr",
}


class _TreeBuilder(HTMLParser):
    """HTML 을 (tag, attrs, children) 트리로. 스트리밍으로 바로 변환하는 것보다
    트리를 한 번 세우고 훑는 편이 목록 중첩·표처럼 자식을 다 봐야 하는 것에서 훨씬 단순하다."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#root", "attrs": {}, "children": []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1]["children"].append({"tag": tag, "attrs": dict(attrs), "children": []})

    def handle_endtag(self, tag):
        # 닫는 태그 짝이 안 맞아도 트리를 깨뜨리지 않는다 — 옛 본문에 흐트러진 HTML 이 있을 수 있다
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1]["children"].append(data)


def _parse(html: str) -> dict:
    builder = _TreeBuilder()
    builder.feed(html or "")
    builder.close()
    return builder.root


def _escape_md(text: str) -> str:
    """마크다운 기호로 오해될 글자만 막는다. 전부 이스케이프하면 읽기 나빠진다."""
    return re.sub(r"([*_`\[\]])", r"\\\1", text)


class MarkdownWriter:
    """트리를 마크다운으로. 블록은 줄 단위, 인라인은 글자 단위로 모은다."""

    def __init__(self):
        self.blocks: list[str] = []

    # ── 인라인 ──

    def inline(self, node) -> str:
        if isinstance(node, str):
            return _escape_md(node)

        tag = node["tag"]
        attrs = node["attrs"]

        if tag == "br":
            return "  \n"
        if tag == "img":
            return f"![{attrs.get('alt', '')}]({attrs.get('src', '')})"
        if tag == "span" and "data-mention" in attrs:
            return self.mention(attrs, self.plain(node))
        if tag == "span" and "data-math-inline" in attrs:
            return f"${attrs.get('data-latex', '')}$"
        if tag == "span" and "data-status" in attrs:
            return f"`{attrs.get('data-label', '')}`"

        if tag == "code":
            # 코드 안에서는 이스케이프가 글자를 더럽힌다
            return f"`{self.plain(node)}`"

        inner = "".join(self.inline(c) for c in node["children"])
        if tag in INLINE_WRAP:
            if not inner.strip():
                return inner
            mark = INLINE_WRAP[tag]
            return f"{mark}{inner}{mark}"
        if tag == "a":
            return f"[{inner}]({attrs.get('href', '')})"
        return inner

    @staticmethod
    def mention(attrs: dict, inner: str) -> str:
        kind = attrs.get("data-kind", "")
        label = attrs.get("data-label") or inner.strip("[]@#")
        if kind == "doc":
            # Obsidian 위키링크. 원래 문서 id 는 주석으로 옆에 남겨 되돌릴 수 있게 한다.
            return f'[[{label}]]<!--orbitail:doc id="{attrs.get("data-id", "")}"-->'
        if kind == "label":
            return f"#{label}"
        if kind == "user":
            return f"@{label}"
        return label

    def plain(self, node) -> str:
        """이스케이프 없이 글자만 — 코드 블록·멘션 안에서 쓴다."""
        if isinstance(node, str):
            return node
        if node["tag"] == "br":
            return "\n"
        return "".join(self.plain(c) for c in node["children"])

    # ── 블록 ──

    def add(self, text: str) -> None:
        if text.strip():
            self.blocks.append(text.rstrip())

    def walk(self, node) -> None:
        for child in node["children"]:
            self.block(child)

    def block(self, node) -> None:
        if isinstance(node, str):
            if node.strip():
                self.add(_escape_md(node))
            return

        tag = node["tag"]
        attrs = node["attrs"]

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.add(f"{'#' * int(tag[1])} {self.inline_children(node)}")
        elif tag == "p":
            self.add(self.inline_children(node))
        elif tag == "hr":
            self.add("---")
        elif tag in ("ul", "ol"):
            self.add(self.list_block(node, depth=0))
        elif tag == "blockquote":
            body = MarkdownWriter()
            body.walk(node)
            self.add("\n".join(f"> {line}" if line else ">" for line in body.text().split("\n")))
        elif tag == "pre":
            self.add(self.code_block(node))
        elif tag == "table":
            self.add(self.table_block(node))
        elif tag == "div" and attrs.get("data-node") == "callout":
            self.add(self.callout_block(node))
        elif tag == "div" and "data-math-block" in attrs:
            self.add(f"$$\n{attrs.get('data-latex', '')}\n$$")
        elif tag == "div" and "data-mermaid" in attrs:
            self.add(f"```mermaid\n{attrs.get('data-code', '')}\n```")
        elif tag == "div" and attrs.get("data-node") in ("video", "pdf", "attachment"):
            src = attrs.get("data-src") or attrs.get("data-url") or ""
            name = attrs.get("data-filename") or attrs.get("data-name") or attrs.get("data-node")
            self.add(f"[{name}]({src})" if src else f"`{name}`")
        elif tag == "div" and ("data-issue-card" in attrs or "data-issue-view" in attrs):
            self.add(self.issue_block(attrs))
        else:
            # 모르는 컨테이너(div, 칼럼, 접기 등)는 껍데기만 벗기고 안쪽을 이어서 본다
            if any(isinstance(c, dict) and c["tag"] in BLOCK_TAGS for c in node["children"]):
                self.walk(node)
            else:
                self.add(self.inline_children(node))

    def inline_children(self, node) -> str:
        return "".join(self.inline(c) for c in node["children"]).strip()

    def list_block(self, node, depth: int) -> str:
        ordered = node["tag"] == "ol"
        pad = "  " * depth
        lines: list[str] = []
        index = 1
        for child in node["children"]:
            if not isinstance(child, dict) or child["tag"] != "li":
                continue
            checked = child["attrs"].get("data-checked")
            if checked is not None:
                marker = "- [x]" if checked == "true" else "- [ ]"
            elif ordered:
                marker = f"{index}."
                index += 1
            else:
                marker = "-"

            # li 안의 중첩 목록은 따로 떼어 들여쓴다
            nested = [c for c in child["children"] if isinstance(c, dict) and c["tag"] in ("ul", "ol")]
            own = {"tag": "li", "attrs": {}, "children": [c for c in child["children"] if c not in nested]}
            inner = MarkdownWriter()
            inner.walk(own)
            text = inner.text().replace("\n", " ").strip() or self.inline_children(own)
            lines.append(f"{pad}{marker} {text}".rstrip())
            for sub in nested:
                lines.append(self.list_block(sub, depth + 1))
        return "\n".join(lines)

    def code_block(self, node) -> str:
        lang = ""
        body = node
        for child in node["children"]:
            if isinstance(child, dict) and child["tag"] == "code":
                body = child
                m = re.search(r"language-([\w+-]+)", child["attrs"].get("class", ""))
                if m:
                    lang = m.group(1)
                break
        return f"```{lang}\n{self.plain(body).rstrip()}\n```"

    def table_block(self, node) -> str:
        rows: list[list[str]] = []
        header_seen = False

        def collect(n):
            nonlocal header_seen
            for child in n["children"]:
                if not isinstance(child, dict):
                    continue
                if child["tag"] == "tr":
                    cells = [
                        self.inline_children(c).replace("|", "\\|")
                        for c in child["children"]
                        if isinstance(c, dict) and c["tag"] in ("td", "th")
                    ]
                    if any(isinstance(c, dict) and c["tag"] == "th" for c in child["children"]) and not rows:
                        header_seen = True
                    rows.append(cells)
                else:
                    collect(child)

        collect(node)
        if not rows:
            return ""
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        # GFM 표는 머리글 줄이 있어야 표로 읽힌다. th 가 없으면 빈 머리글을 넣는다.
        if not header_seen:
            rows.insert(0, [""] * width)
        lines = [
            "| " + " | ".join(rows[0]) + " |",
            "| " + " | ".join("---" for _ in range(width)) + " |",
        ]
        for row in rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)

    def callout_block(self, node) -> str:
        kind = node["attrs"].get("data-kind", "info")
        body = MarkdownWriter()
        body.walk(node)
        lines = [f"> [!{kind}]"]
        lines += [f"> {line}" if line else ">" for line in body.text().split("\n")]
        return "\n".join(lines)

    @staticmethod
    def issue_block(attrs: dict) -> str:
        issue_id = attrs.get("data-id", "")
        identifier = attrs.get("data-identifier", "")
        label = attrs.get("data-label", "")
        meta = f'<!--orbitail:issue id="{issue_id}" identifier="{identifier}"-->'
        shown = f"{identifier} {label}".strip() or issue_id
        return f"{meta}\n`{shown}`"

    def text(self) -> str:
        return "\n\n".join(self.blocks)


def html_to_markdown(html: str) -> str:
    writer = MarkdownWriter()
    writer.walk(_parse(html))
    return writer.text()


# ──────────────────────────────────────────────────────────────
# 머리말(frontmatter)
# ──────────────────────────────────────────────────────────────

def build_frontmatter(doc) -> dict:
    """문서의 YAML 머리말로 나갈 값. 사용자 프로퍼티에 내장 필드를 얹는다.

    `tags` 는 Obsidian 이 태그로 읽는 이름이라 라벨을 그 이름으로 내보낸다.
    `orbitail-id` 는 되돌려 읽을 때 같은 문서를 알아보기 위한 것.
    """
    data: dict = {
        "title": doc.title,
        "orbitail-id": str(doc.id),
    }
    tags = [label.name for label in doc.labels.all()]
    if tags:
        data["tags"] = tags
    # 표(폴더 데이터베이스)의 문서라면 칸 순서대로 먼저 싣는다 — 사람이 읽을 때 순서가 뒤죽박죽이면
    # 같은 표의 파일들이 서로 달라 보인다. 값이 비어 있는 칸은 넣지 않는다.
    parent = doc.parent
    handled: set[str] = set()
    for column in (parent.db_columns or []) if parent else []:
        name = column.get("name")
        value = (doc.properties or {}).get(name)
        if not name:
            continue
        handled.add(name)
        # 문서에서 파생되는 칸 — properties 에 값이 없고 문서 자체에서 읽는다
        ctype = column.get("type")
        if ctype in ("created", "updated"):
            stamp = doc.created_at if ctype == "created" else doc.updated_at
            if stamp:
                data[name] = stamp.date().isoformat()
            continue
        if value in (None, "", []):
            continue
        # 가리키는 칸은 사람이 읽는 형태로 눕힌다 — 머리말에 {id, label} 묶음이 그대로 나가면
        # 다른 마크다운 앱에서 알아볼 수 없다. 문서는 위키링크로, 이슈는 식별자로.
        if isinstance(value, dict):
            label = value.get("label") or value.get("id") or ""
            data[name] = f"[[{label}]]" if column.get("type") == "doc" else label
        else:
            data[name] = value
    if doc.created_at:
        data["created"] = doc.created_at.date().isoformat()
    if doc.updated_at:
        data["updated"] = doc.updated_at.date().isoformat()
    # 칸으로 다루지 않은 값(가져온 볼트의 머리말 등)도 버리지 않는다.
    # 칸으로 이미 넣은 것은 건너뛴다 — 여기서 다시 쓰면 위에서 눕혀 둔 형태가 원래 묶음으로 되돌아간다.
    for key, value in (doc.properties or {}).items():
        if key in handled:
            continue
        # 칸 밖에서 들어온 묶음도 사람이 읽는 형태로
        data[key] = (value.get("label") or value.get("id") or "") if isinstance(value, dict) else value
    return data


def document_to_markdown(doc) -> str:
    """머리말 + 본문. Obsidian 볼트에 그대로 떨어뜨릴 수 있는 한 장."""
    import yaml

    front = yaml.safe_dump(
        build_frontmatter(doc),
        allow_unicode=True,      # 한글이 \uXXXX 로 나가면 사람이 못 읽는다
        sort_keys=False,
        default_flow_style=False,
    )
    body = html_to_markdown(doc.content_html)
    return f"---\n{front}---\n\n{body}\n"


# ──────────────────────────────────────────────────────────────
# 마크다운 → HTML (반입)
# ──────────────────────────────────────────────────────────────
#
# 내보내기와 같은 이유로 라이브러리를 들이지 않는다. 읽어야 하는 것이 우리가 내보낸 파일과
# Obsidian 볼트로 정해져 있고, 되돌릴 때 콜아웃·위키링크·이슈 카드를 원래 노드로 복원해야
# 하는데 그건 어차피 범용 변환기가 해 주지 않는다.

from django.utils.html import escape as _html_escape

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_DOC_META_RE = re.compile(r'<!--orbitail:doc id="([^"]*)"-->')
_ISSUE_META_RE = re.compile(r'<!--orbitail:issue id="([^"]*)" identifier="([^"]*)"-->')


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """맨 앞 `---` 블록을 읽어 (머리말, 본문)으로 가른다. 없으면 ({}, 원문)."""
    m = _FRONTMATTER_RE.match(text or "")
    if not m:
        return {}, text or ""
    try:
        import yaml
        data = yaml.safe_load(m.group(1)) or {}
    except Exception:
        # 머리말이 깨졌다고 본문까지 버리지 않는다 — 머리말만 포기한다
        return {}, text[m.end():]
    if not isinstance(data, dict):
        return {}, text[m.end():]
    return data, text[m.end():]


class _Inline:
    """인라인 변환. 코드 조각을 먼저 빼돌려 그 안의 기호가 강조로 해석되지 않게 한다."""

    def __init__(self, resolve_wikilink=None):
        self.resolve = resolve_wikilink

    def run(self, text: str) -> str:
        vault: list[str] = []

        def stash(html: str) -> str:
            vault.append(html)
            return f"\x00{len(vault) - 1}\x00"

        # 1) 코드 조각 — 가장 먼저 빼돌린다
        text = re.sub(r"`([^`]+)`", lambda m: stash(f"<code>{_html_escape(m.group(1))}</code>"), text)

        # 2) 이슈 메타 주석 — 되돌리기 정보가 있으면 원래 카드로
        text = _ISSUE_META_RE.sub(
            lambda m: stash(
                f'<div data-issue-card="" data-id="{_html_escape(m.group(1))}" '
                f'data-identifier="{_html_escape(m.group(2))}" data-label=""></div>'
            ),
            text,
        )

        # 3) 위키링크 — 뒤에 우리 메타 주석이 붙어 있으면 그 id 를 그대로 쓴다
        def wikilink(m):
            title = m.group(1).strip()
            meta = m.group(2)
            doc_id, space_id = "", ""
            if meta:
                doc_id = _DOC_META_RE.match(meta).group(1)
            elif self.resolve:
                found = self.resolve(title)
                if found:
                    doc_id, space_id = found
            if not doc_id:
                # 가리키는 문서를 못 찾으면 글자로 남긴다 — 빈 곳을 가리키는 링크를 만들지 않는다
                return stash(_html_escape(f"[[{title}]]"))
            return stash(
                f'<span data-mention="" data-kind="doc" data-id="{doc_id}" '
                f'data-label="{_html_escape(title)}" data-identifier="" '
                f'data-space="{space_id}" class="doc-mention doc-mention-doc">[[{_html_escape(title)}]]</span>'
            )

        text = re.sub(r"\[\[([^\]]+)\]\](<!--orbitail:doc id=\"[^\"]*\"-->)?", wikilink, text)

        # 4) 이미지 → 링크 순서. 링크를 먼저 하면 `![...]` 의 `!` 가 떨어져 나간다
        text = re.sub(
            r"!\[([^\]]*)\]\(([^)]+)\)",
            lambda m: stash(f'<img src="{_html_escape(m.group(2))}" alt="{_html_escape(m.group(1))}">'),
            text,
        )
        text = re.sub(
            r"\[([^\]]+)\]\(([^)]+)\)",
            lambda m: stash(f'<a href="{_html_escape(m.group(2))}">{self.run(m.group(1))}</a>'),
            text,
        )

        # 5) 수식
        text = re.sub(
            r"\$([^$\n]+)\$",
            lambda m: stash(
                f'<span data-math-inline="" data-latex="{_html_escape(m.group(1))}" '
                f'class="doc-math">{_html_escape(m.group(1))}</span>'
            ),
            text,
        )

        # 6) 남은 글자를 이스케이프한 뒤 강조를 입힌다 — 순서가 반대면 `<` 가 태그로 샌다
        text = _html_escape(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
        text = re.sub(r"~~(.+?)~~", r"<s>\1</s>", text)
        text = re.sub(r"==(.+?)==", r"<mark>\1</mark>", text)
        # 내보낼 때 넣은 이스케이프(`\*` 등)를 되돌린다
        text = re.sub(r"\\([*_`\[\]])", r"\1", text)

        for i, html in enumerate(vault):
            text = text.replace(f"\x00{i}\x00", html)
        return text


def markdown_to_html(md: str, resolve_wikilink=None) -> str:
    """마크다운 본문을 에디터가 읽는 HTML 로.

    resolve_wikilink(title) -> (doc_id, space_id) | None
        `[[제목]]` 을 실제 문서로 잇기 위한 조회. 없으면 위키링크는 글자로 남는다.
    """
    inline = _Inline(resolve_wikilink)
    lines = (md or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0

    def indent_of(line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # 코드 울타리
        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            body: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1  # 닫는 울타리
            code = _html_escape("\n".join(body))
            if lang == "mermaid":
                out.append(f'<div data-mermaid="" data-code="{code}" class="doc-mermaid"></div>')
            else:
                cls = f' class="language-{_html_escape(lang)}"' if lang else ""
                out.append(f"<pre><code{cls}>{code}</code></pre>")
            continue

        # 인용 / 콜아웃 — 둘 다 `>` 로 시작한다
        if stripped.startswith(">"):
            quoted: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quoted.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            kind_match = re.match(r"^\[!(\w+)\]", quoted[0].strip()) if quoted else None
            if kind_match:
                kind = kind_match.group(1).lower()
                # 우리가 쓰는 네 가지 밖이면 info 로 받는다 — Obsidian 은 종류가 훨씬 많다
                if kind not in ("info", "success", "warning", "danger"):
                    kind = {"tip": "success", "note": "info", "caution": "danger",
                            "error": "danger", "bug": "danger", "warning": "warning"}.get(kind, "info")
                inner = markdown_to_html("\n".join(quoted[1:]), resolve_wikilink)
                out.append(
                    f'<div data-node="callout" data-kind="{kind}" '
                    f'class="doc-callout doc-callout-{kind}">{inner}</div>'
                )
            else:
                out.append(f"<blockquote>{markdown_to_html(chr(10).join(quoted), resolve_wikilink)}</blockquote>")
            continue

        # 제목
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline.run(heading.group(2))}</h{level}>")
            i += 1
            continue

        # 구분선
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            out.append("<hr>")
            i += 1
            continue

        # 표 — 둘째 줄이 구분줄이어야 표다
        if stripped.startswith("|") and i + 1 < len(lines) and re.fullmatch(
            r"\|[\s:\-|]+\|", lines[i + 1].strip()
        ):
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip().strip("|")
                if not re.fullmatch(r"[\s:\-|]+", raw):
                    rows.append([c.strip() for c in re.split(r"(?<!\\)\|", raw)])
                i += 1
            if rows:
                head = "".join(f"<th><p>{inline.run(c)}</p></th>" for c in rows[0])
                body = "".join(
                    "<tr>" + "".join(f"<td><p>{inline.run(c)}</p></td>" for c in r) + "</tr>"
                    for r in rows[1:]
                )
                out.append(f"<table><tbody><tr>{head}</tr>{body}</tbody></table>")
            continue

        # 목록
        if re.match(r"^\s*([-*+]|\d+\.)\s+", line):
            block, base = [], indent_of(line)
            while i < len(lines) and (
                re.match(r"^\s*([-*+]|\d+\.)\s+", lines[i]) or (lines[i].strip() and indent_of(lines[i]) > base)
            ):
                block.append(lines[i])
                i += 1
            out.append(_list_html(block, inline, resolve_wikilink))
            continue

        # 문단 — 빈 줄까지 모은다
        para: list[str] = []
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^\s*(#{1,6}\s|>|```|\||([-*+]|\d+\.)\s)", lines[i]
        ):
            para.append(lines[i].strip())
            i += 1
        if para:
            out.append(f"<p>{inline.run(' '.join(para))}</p>")
        else:
            i += 1

    return "".join(out)


def _list_html(block: list[str], inline: "_Inline", resolve_wikilink) -> str:
    """들여쓰기로 중첩을 판단해 ul/ol 로. 체크박스가 있으면 할 일 목록으로."""
    if not block:
        return ""
    base = len(block[0]) - len(block[0].lstrip(" "))
    ordered = bool(re.match(r"^\s*\d+\.\s", block[0]))
    is_task = bool(re.match(r"^\s*[-*+]\s+\[[ xX]\]\s", block[0]))

    items: list[str] = []
    idx = 0
    while idx < len(block):
        line = block[idx]
        m = re.match(r"^\s*(?:[-*+]|\d+\.)\s+(.*)$", line)
        if not m:
            idx += 1
            continue
        text = m.group(1)
        checked = None
        task = re.match(r"^\[([ xX])\]\s*(.*)$", text)
        if task:
            checked = task.group(1).lower() == "x"
            text = task.group(2)

        # 이 항목에 딸린 더 깊은 줄들을 모아 재귀
        nested: list[str] = []
        idx += 1
        while idx < len(block) and (len(block[idx]) - len(block[idx].lstrip(" "))) > base:
            nested.append(block[idx])
            idx += 1

        inner = f"<p>{inline.run(text)}</p>"
        if nested:
            inner += _list_html(nested, inline, resolve_wikilink)
        attr = f' data-checked="{"true" if checked else "false"}"' if checked is not None else ""
        items.append(f"<li{attr}>{inner}</li>")

    tag = "ol" if ordered else "ul"
    type_attr = ' data-type="taskList"' if is_task else ""
    return f"<{tag}{type_attr}>{''.join(items)}</{tag}>"
