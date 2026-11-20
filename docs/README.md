# docs/: agent-commerce design

This directory holds the design documents for **agent-commerce**. agent-commerce is a proof-of-concept blueprint for multi-agent orchestration. An e-commerce shop is the example use case. The code follows [work-plan.md](work-plan.md).

## Start here

1. Read [multi-agent-design.md](multi-agent-design.md). It is the source of truth for the architecture.
2. Read [technical-landscape.md](technical-landscape.md). It is the source of truth for the stack.
3. Read [demo-runbook.md](demo-runbook.md) to run the show-and-tell.

## Files (v7 set, 10 Nov 2026)

| File | What it is |
| --- | --- |
| [multi-agent-design.md](multi-agent-design.md) | **v7 architecture**, 14 sections. Core rules, layers, actors, success path, event catalogue, MCP servers, draft states, how to add a service, containers, databases, RabbitMQ setup. |
| [technical-landscape.md](technical-landscape.md) | 34 stack decisions with versions, licenses, sources and "not verified" marks. Repo layout, runtime settings, agent loop, thin-path checklist. |
| [work-plan.md](work-plan.md) | **Work plan** for the v7 build: inventory, design gaps, six phases with 47 tasks and one check each, and the result of each phase. |
| [demo-runbook.md](demo-runbook.md) | The show-and-tell step by step, with curl fallbacks and the failure paths. |
| [multi-agent-layers-v7.svg](multi-agent-layers-v7.svg) | **Layer view**: what the system is made of. Six bands: actors, entry points, event bus, reactors, MCP servers, services and data. |
| [multi-agent-layers-v7.png](multi-agent-layers-v7.png) | PNG render of the layer view. |
| [layers.py](layers.py) | Generator for the layer view. It checks for box overlaps. |
| [multi-agent-flow-v7.svg](multi-agent-flow-v7.svg) | **Flow view**: what happens to an order. Edges e1–e36. The edge list is in an SVG comment. Green numbers 1–9 are the success steps in design §4. |
| [multi-agent-flow-v7.png](multi-agent-flow-v7.png) | PNG render of the flow view. |
| [gen6.py](gen6.py) | Generator and validator for the flow view. The edge list in the script is the source of truth for the drawing. |

## History note

The design started in a private notes repository, and the code moved here on 21 Nov 2026. `work-plan.md` is a record of the build. It names some inputs that are not in this repository: a handoff note, an earlier 7 Nov proposal set, and a slide deck. Paths such as `agent-commerce/` in the plan mean the root of this repository.

## Regenerate the diagrams

Run these commands from the repo root:

```sh
python3 docs/layers.py docs/multi-agent-layers-v7.svg
python3 docs/gen6.py docs/multi-agent-flow-v7.svg
```

- `layers.py` prints `box overlaps: []` and `right edge: 1352`.
- `gen6.py` prints `36 edges, 8 problems`. The 8 problems are the step badges on their own arrows. They are known.
- The scripts do not write the PNG files. To make a PNG at the committed size (2× the SVG), run `rsvg-convert -z 2 <file>.svg -o <file>.png`.
