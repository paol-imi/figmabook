---
layout: home
title: Holotype
titleTemplate: Storybook components as native Figma components

hero:
  name: Holotype
  text: Code-aligned design branches, verified AI implementation
  tagline: Holotype builds a native, editable Figma library from your Storybook. Designers edit it on a branch. Holotype turns their edits into an exact change request for an AI coding agent, then checks the agent's code.
  actions:
    - theme: brand
      text: How it works
      link: /guide/how-it-works
    - theme: alt
      text: Roadmap
      link: /roadmap

features:
  - title: "Job 1: code to Figma"
    details: Holotype renders your Storybook stories and rebuilds them in Figma as real component sets, with variants, properties, auto layout and variables. Re-imports update components in place and keep designer overrides.
  - title: "Job 2: Figma edits to a change request"
    details: For each git feature branch, designers edit a Figma branch of the library. On Submit, Holotype compares the file with the code it came from and writes a deterministic design change request, with file:line provenance and tokens.
  - title: "Then: AI implements, Holotype verifies"
    details: An AI coding agent of your choice implements the request. holotype verify renders the new code again and checks every item. Partial work produces a follow-up request with only what is left.
---

## Status

Holotype is **pre-release**. It is in the first stage of its [roadmap](/roadmap) (L0, the walking skeleton). There is no released CLI, no published plugin and no stable configuration yet.

This site describes how Holotype is designed to work. Pages say when something is planned rather than available. Commands, options and screens may still change before the first release.

## Who it is for

- **Design-system teams** who keep a Storybook in code and a component library in Figma, and are tired of redrawing one from the other.
- **Designers** who want to change real, synced components and draw screens with them, without writing a spec by hand.
- **Developers** who want design changes as a precise, checkable task for their AI coding agent, instead of a screenshot and a guess.

## What Holotype does not do

- It does not write component code. Your AI agent does, from the change request.
- It does not sync Figma edits into code automatically. Every change goes through a change request and a reviewed pull request.
- It does not render stories inside Figma. Rendering happens in a headless Chromium on your machine or in CI.
- It does not send your Storybook or code to a hosted service.
