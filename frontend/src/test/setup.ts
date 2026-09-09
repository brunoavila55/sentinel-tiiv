import "@testing-library/jest-dom/vitest";

// jsdom não implementa ResizeObserver; o React Flow (Prompt 15) depende
// dele pra medir o canvas. Sem isso, qualquer teste que monte TopologyPage
// quebra antes mesmo de começar a asserção.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const globalWithResizeObserver = globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub };
globalWithResizeObserver.ResizeObserver ??= ResizeObserverStub;
