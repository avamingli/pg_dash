import '@testing-library/jest-dom/vitest';
// jsdom ships no IndexedDB, which the /replay recording library needs;
// this installs an in-memory one on globalThis. State lives as long as
// the worker, so tests that write must clean up after themselves.
import 'fake-indexeddb/auto';
