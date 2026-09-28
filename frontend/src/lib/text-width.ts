let context: CanvasRenderingContext2D | null | undefined;

/**
 * Largura em px de um texto numa fonte CSS, medida com canvas. Sem canvas
 * (ex.: jsdom nos testes), cai numa estimativa por caractere.
 */
export function measureText(text: string, font: string): number {
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}
