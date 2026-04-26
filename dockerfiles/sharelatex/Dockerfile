FROM develop-web

USER root

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) typst_arch="x86_64" ;; \
      arm64) typst_arch="aarch64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fLso /tmp/typst.tar.xz "https://github.com/typst/typst/releases/latest/download/typst-${typst_arch}-unknown-linux-musl.tar.xz"; \
    mkdir -p /tmp/typst; \
    tar -xJf /tmp/typst.tar.xz -C /tmp/typst; \
    install -m 0755 "/tmp/typst/typst-${typst_arch}-unknown-linux-musl/typst" /usr/local/bin/typst; \
    rm -rf /tmp/typst /tmp/typst.tar.xz
