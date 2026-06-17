# Architecture Decision Records

This folder records significant architectural decisions for the project, one
file per decision. Each record captures the context, the decision, and its
consequences so the reasoning stays available later.

## Format

Files are named `NNNN-short-title.md` (zero-padded, increasing). Each record
follows a lightweight [MADR](https://adr.github.io/madr/)-style template:

- **Status** — proposed | accepted | superseded
- **Context** — the problem and constraints
- **Decision** — what was chosen
- **Consequences** — trade-offs, follow-ups, what we accept

## Index

| ADR | Title | Status |
| --- | ----- | ------ |
| [0001](0001-dockerize-backend-and-agents.md) | Dockerize backend and client agents | accepted |
| [0002](0002-grafana-integration.md) | Add Grafana for dashboards and historical views | proposed |
