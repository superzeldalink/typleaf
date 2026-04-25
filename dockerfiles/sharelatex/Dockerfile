FROM sharelatex/sharelatex

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fLso /tmp/typst.tar.xz "https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz"; \
    mkdir -p /tmp/typst; \
    tar -xJf /tmp/typst.tar.xz -C /tmp/typst; \
    install -m 0755 /tmp/typst/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst; \
    rm -rf /tmp/typst /tmp/typst.tar.xz

COPY dockerfiles/sharelatex/LatexRunner.js /overleaf/services/clsi/app/js/LatexRunner.js

RUN set -eux; \
    sed -i "s/\\['pdflatex', 'latex', 'xelatex', 'lualatex'\\]/['pdflatex', 'latex', 'xelatex', 'lualatex', 'typst']/" /overleaf/services/clsi/app/js/RequestParser.js; \
    sed -i "s/\\['pdflatex', 'latex', 'xelatex', 'lualatex'\\]/['pdflatex', 'latex', 'xelatex', 'lualatex', 'typst']/" /overleaf/services/web/app/src/Features/Compile/ClsiManager.mjs; \
    sed -i "s/\\['xelatex', 'pdflatex', 'latex', 'lualatex'\\]/['xelatex', 'pdflatex', 'latex', 'lualatex', 'typst']/" /overleaf/services/web/app/src/Features/Project/ProjectOptionsHandler.mjs
