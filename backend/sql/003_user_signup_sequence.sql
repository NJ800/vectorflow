-- VectorFlow: job-seeker self-signup (POST /auth/signup) needs a source of
-- new user_id values that can never collide with the 500 seeded synthetic
-- users (ids 1-500, loaded by scripts/generate_users.py via explicit
-- INSERT, so users.user_id has no owned sequence of its own). Starting well
-- clear of that range, rather than MAX(user_id)+1, avoids a race under
-- concurrent signups.
CREATE SEQUENCE IF NOT EXISTS users_new_id_seq START WITH 100000;
