import { classifyBerg, parseBergPayload, scoreBerg } from './schema.zod';

describe('Berg scorer', () => {
  const fullPayload = Object.fromEntries(
    Array.from({ length: 14 }, (_, index) => [`berg_${index + 1}`, 4]),
  );

  it('soma 14 itens válidos', () => {
    const payload = parseBergPayload(fullPayload);
    expect(scoreBerg(payload)).toBe(56);
    expect(classifyBerg(56).classificationCode).toBe('BERG_LOW');
  });

  it('classifica faixas conforme assess.md §4', () => {
    expect(classifyBerg(20).classificationLabel).toBe(
      'Prejuízo do equilíbrio (0–20)',
    );
    expect(classifyBerg(21).classificationLabel).toBe(
      'Equilíbrio aceitável (21–40)',
    );
    expect(classifyBerg(40).classificationCode).toBe('BERG_MODERATE');
    expect(classifyBerg(41).classificationLabel).toBe('Bom equilíbrio (41–56)');
  });

  it('rejeita item ausente', () => {
    const incomplete = { ...fullPayload };
    delete (incomplete as Record<string, unknown>).berg_14;
    expect(() => parseBergPayload(incomplete)).toThrow();
  });

  it('rejeita valor fora de 0–4', () => {
    expect(() => parseBergPayload({ ...fullPayload, berg_1: 5 })).toThrow();
  });
});
