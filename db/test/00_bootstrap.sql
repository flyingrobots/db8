BEGIN;
SELECT plan(1);
SELECT pass('db8 pgTAP bootstrap');
SELECT * FROM finish();
ROLLBACK;

