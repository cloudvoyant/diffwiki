---
title: What's Next?
tags:
  - overview
  - roadmap
  - rag
  - agents
  - feedback
---

# What's Next?

diffwiki exists for three overlapping kinds of work: development, technical documentation, and knowledge mining. In all three you accumulate notes that belong next to the code they describe, that live in distributed git repositories, and that you nonetheless want to publish and share. Your knowledge stays as plain markdown under version control, yet it browses, searches, and publishes like a finished website. This page says out loud where the project is going and why — the vision behind it, the concrete roadmap ahead, and where to send feedback.

## Vision

The reason the project goes further than "a nice wiki" is that software is increasingly written and documented with agents, and agents accumulate memory. Today that memory usually disappears into an opaque vector store: a pile of embeddings you cannot read, cannot diff, and cannot correct. You are asked to trust a retrieval system whose contents you can never actually inspect.

diffwiki takes the opposite position. Agent memory should be markdown — files you can open, diff in a pull request, search by hand, and edit when they are wrong. As agents work, they write findings into [collections](/user-guide/collections) as ordinary articles, tagged for retrieval, and that memory is git-tracked so every change to what the agent "knows" shows up in history like any other change to the codebase. This is what makes retrieval-augmented generation trustworthy here: RAG becomes something a human can inspect and trust — when an answer is wrong you do not guess at a hidden index, you run the [same query](/user-guide/search-and-rag), read the same documents, and fix the source.

It follows that diffwiki is **memory-agnostic**. The vector store or embedding model is never the source of truth — it is a [swappable plugin](/user-guide/search-and-rag) over content that always stays as markdown in git. You can change memory backends, or run several, and lose nothing: switching is an index rebuild, not a data migration. Your knowledge outlives whatever retrieval system is fashionable this year.

### But still a wiki

Yes, RAG. Yes, agent memory. But diffwiki is also a real wiki — a place where people collaborate with transparency and share knowledge. It is not just a memory backend bolted onto a search box: it is a genuine, human-first wiki you read, edit, review in diffs, and share. People [contribute](/user-guide/continuous-learning) to it, [share](/user-guide/sharing) it, and read it the way they would read any documentation site. The memory and RAG capabilities enrich that wiki rather than replace it — the observability makes the shared knowledge easier to trust, but the wiki comes first.

## Roadmap

diffwiki is developed in the open, and this roadmap is an ordered sequence of work rather than dated promises. Each step extends something that already works into something more capable, without breaking the plain-markdown-in-git foundation everything else depends on.

1. **Self-improvement & coding-agent integration** → Deeper integration with [coding agents](/user-guide/coding-agents) through agent skills — the `/dw` skill for query, search, and learn — so that wikis self-improve: as agents work, they capture what they learn back into the wiki.

2. **Multi-repo federation** → diffwiki already handles multiple repos. Next, allow importing other people's repos and handling arbitrary markdown hosted in public and private version control, so a single wiki can span many sources that each stay owned by their own history. This is where the [collections](/user-guide/collections) model pays off.

3. **MCP (if needed)** → Expose diffwiki over MCP where it adds value, so agents that speak MCP can query and retrieve from a wiki directly.

4. **Improved search UX** → Make the search experience consistent across plugins, and show chunking hints so results are legible — you can see how a document was split and why a passage matched. See [Search & RAG](/user-guide/search-and-rag).

5. **Deeper RAG** → Support memory systems beyond QMD, and let users mix and match them, so retrieval is not tied to a single backend.

6. **Deeper MDX support** → Richer user-facing content in docs, so pages can do more than plain markdown allows.

7. **UI editability** → Draft resolution, sync control, and eventually full in-wiki editing, so you can edit the wiki from the wiki itself rather than only from your editor.

8. **Full Helix key bindings** → Keyboard-driven navigation and editing with a complete set of Helix modal key bindings, so moving through and editing your wiki feels like your editor — reading and writing without leaving the keyboard.

9. **Docgen plugins** → Incorporate auto-generated API docs for various languages, or a variant thereof, so reference material stays in sync with the code it describes. See the [API Docs](/api-docs) for what generated reference already looks like.

## Feedback

diffwiki is developed in the open, and feedback is genuinely welcome. To request a feature or report a bug, open an issue on GitHub:

- **[github.com/cloudvoyant/diffwiki/issues](https://github.com/cloudvoyant/diffwiki/issues)**

The GitHub link in the top navigation goes to the same repository, so you are only ever a click away from filing something. If you have an idea from the roadmap above you want to push on, or a rough edge in the [User Guide](/user-guide), an issue is the best place to start the conversation.

## New here?

Start with [Getting Started](/getting-started) and the [User Guide](/user-guide); the [API Docs](/api-docs) cover the [CLI](/api-docs/cli), [diffwiki-core](/api-docs/core), and the [Plugin SDK](/api-docs/plugins).
