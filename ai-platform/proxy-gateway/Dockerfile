FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    redsocks iptables curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY config/redsocks.conf /etc/redsocks.conf.template
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
