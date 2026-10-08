FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    postgresql-14 postgresql-server-dev-14 \
    redis-server \
    openjdk-17-jre-headless \
    python3 python3-pip python3-venv \
    supervisor curl gzip git build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector && make && make install \
    && rm -rf /tmp/pgvector

RUN curl -fSL https://archive.apache.org/dist/kafka/3.7.0/kafka_2.13-3.7.0.tgz -o /tmp/kafka.tgz \
    && mkdir -p /opt/kafka \
    && tar -xzf /tmp/kafka.tgz -C /opt/kafka --strip-components=1 \
    && rm /tmp/kafka.tgz

COPY kafka-server.properties /opt/kafka/config/kraft/server.properties

RUN KAFKA_CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid) \
    && /opt/kafka/bin/kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c /opt/kafka/config/kraft/server.properties

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /app/venv \
    && /app/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && /app/venv/bin/pip install --no-cache-dir fastapi "uvicorn[standard]" redis kafka-python

COPY app/ /app/app/
COPY scripts/ /app/scripts/
COPY sql/ /app/sql/
COPY vectorflow_dump.sql.gz /app/vectorflow_dump.sql.gz

RUN mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql

# Ubuntu's postgresql-14 package splits config (/etc/postgresql/14/main/)
# from data (/var/lib/postgresql/14/main/) -- raw pg_ctl -D doesn't know
# about this split. Use the "service" wrapper instead, which does.
RUN service postgresql start \
    && su postgres -c "psql -c \"CREATE USER vectorflow WITH SUPERUSER PASSWORD 'vectorflow_dev_pw';\"" \
    && su postgres -c "psql -c \"CREATE DATABASE vectorflow OWNER vectorflow;\"" \
    && su postgres -c "gunzip -c /app/vectorflow_dump.sql.gz | psql -d vectorflow" \
    && service postgresql stop

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV POSTGRES_HOST=localhost
ENV POSTGRES_PORT=5432
ENV POSTGRES_DB=vectorflow
ENV POSTGRES_USER=vectorflow
ENV POSTGRES_PASSWORD=vectorflow_dev_pw
ENV JWT_SECRET=f0879c01de8c112ab78da0204f316e75a68641096ed71e9afb9c7bc11ea8ca95


EXPOSE 7860

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]