-- One Postgres server, one database per service (decision D4). Services never share tables.
CREATE DATABASE users;
CREATE DATABASE chat;
