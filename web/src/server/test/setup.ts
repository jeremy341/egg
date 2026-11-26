// Every test file gets an isolated in-memory-ish configuration.
process.env.APP_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.LOCAL_MODE_SECRET = "test-local-mode-secret-test-local-mode-secret";
process.env.APP_URL = "http://localhost:3000";
process.env.DEV_LOGIN = "1";
