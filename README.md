<h1 align="center">
  <br>
  <a href="https://www.overleaf.com"><img src="doc/logo.png" alt="Overleaf" width="300"></a>
</h1>

<h4 align="center">An open-source online real-time collaborative LaTeX editor, with Typst work in progress in this fork.</h4>

<p align="center">
  <a href="https://github.com/overleaf/overleaf/wiki">Wiki</a> •
  <a href="https://www.overleaf.com/for/enterprises">Server Pro</a> •
  <a href="#contributing">Contributing</a> •
  <a href="https://mailchi.mp/overleaf.com/community-edition-and-server-pro">Mailing List</a> •
  <a href="#authors">Authors</a> •
  <a href="#license">License</a>
</p>

<img src="doc/screenshot.png" alt="A screenshot of a project being edited in Overleaf Community Edition">
<p align="center">
  Figure 1: A screenshot of a project being edited in Overleaf Community Edition.
</p>

## Community Edition

[Overleaf](https://www.overleaf.com) is an open-source online real-time collaborative LaTeX editor. This fork also carries active Typst integration work for local development. We run a hosted version at [www.overleaf.com](https://www.overleaf.com), but you can also run your own local version, and contribute to the development of Overleaf.

> [!CAUTION]
> Overleaf Community Edition is intended for use in environments where **all** users are trusted. Community Edition is **not** appropriate for scenarios where isolation of users is required due to Sandbox Compiles not being available. When not using Sandboxed Compiles, users have full read and write access to the `sharelatex` container resources (filesystem, network, environment variables) when running LaTeX compiles.

For more information on Sandbox Compiles check out our [documentation](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/server-pro-only-configuration/sandboxed-compiles).

## Typst Support in This Fork

This repository contains fork-specific Typst work that is separate from upstream Overleaf Community Edition.

### Implemented

- Typst projects can compile in the development stack without pulling in TeX Live for the Typst image path.
- Typst compile output URLs work in local development.
- The file outline works for Typst headings in the code editor.
- PDF sync navigation is implemented for Typst at the block level:
  - headings
  - text paragraphs
  - `#figure(...)` blocks, including tables wrapped in figures
- The `Visual Editor` toggle is hidden for `.typ` files for now, so Typst stays in code-editor mode.

### Planned / Not Yet Implemented

- A real Typst visual editor.
- Finer-grained Typst sync inside a paragraph or inline span (for example, word-level or character-level sync).
- Standalone table anchors outside `#figure(...)`.
- More precise table and figure targeting, such as caption-only or cell-level sync.
- Broader Typst UX polish and parity work across the editor.

### Known Limitations / Current Bugs

- PDF-to-code inverse sync for Typst is currently disabled in the PDF preview UI.
- The disablement is intentional for now because double-clicking PDF text could resolve to the wrong source location in some documents.
- Code-to-PDF sync remains available, but Typst sync behavior should still be treated as work in progress.
- If you are testing Typst in this fork, expect rough edges around sync precision, anchor selection, and editor/PDF parity.

## Enterprise

If you want help installing and maintaining Overleaf in your lab or workplace, we offer an officially supported version called [Overleaf Server Pro](https://www.overleaf.com/for/enterprises). It also includes more features for security (SSO with LDAP or SAML), administration and collaboration (e.g. tracked changes). [Find out more!](https://www.overleaf.com/for/enterprises)

## Keeping up to date

Sign up to the [mailing list](https://mailchi.mp/overleaf.com/community-edition-and-server-pro) to get updates on Overleaf releases and development.

## Installation

We have detailed installation instructions in the [Overleaf Toolkit](https://github.com/overleaf/toolkit/).

## Upgrading

If you are upgrading from a previous version of Overleaf, please see the [Release Notes section on the Wiki](https://github.com/overleaf/overleaf/wiki#release-notes) for all of the versions between your current version and the version you are upgrading to.

## Overleaf Docker Image

This repo contains two dockerfiles, [`Dockerfile-base`](server-ce/Dockerfile-base), which builds the
`sharelatex/sharelatex-base` image, and [`Dockerfile`](server-ce/Dockerfile) which builds the
`sharelatex/sharelatex` (or "community") image.

The Base image generally contains the basic dependencies like `wget`, plus `texlive`.
We split this out because it's a pretty heavy set of
dependencies, and it's nice to not have to rebuild all of that every time.

The `sharelatex/sharelatex` image extends the base image and adds the actual Overleaf code
and services.

Use `make build-base` and `make build-community` from `server-ce/` to build these images.

We use the [Phusion base-image](https://github.com/phusion/baseimage-docker)
(which is extended by our `base` image) to provide us with a VM-like container
in which to run the Overleaf services. Baseimage uses the `runit` service
manager to manage services, and we add our init-scripts from the `server-ce/runit`
folder.

## Contributing

Please see the [CONTRIBUTING](CONTRIBUTING.md) file for information on contributing to the development of Overleaf.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2025.
