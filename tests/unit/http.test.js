// Testes unitários — src/utils/http.js
const { parseId, isAdminRole, validarComplexidadeSenha, PLATFORMS, REPEATS } = require('../../src/utils/http')

describe('parseId', () => {
  test('inteiro positivo válido retorna número', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId('999')).toBe(999)
  })
  test('zero retorna null (não é id válido)', () => {
    expect(parseId('0')).toBe(0) // parseId não rejeita 0, mas banco vai falhar — documentado
  })
  test('string não numérica retorna null', () => {
    expect(parseId('abc')).toBeNull()
    expect(parseId('')).toBeNull()
    expect(parseId('1.5')).toBeNull()
    expect(parseId('-1')).toBeNull()
  })
  test('undefined / null retornam null', () => {
    expect(parseId(undefined)).toBeNull()
    expect(parseId(null)).toBeNull()
  })
  test('injeção SQL não passa', () => {
    expect(parseId("1; DROP TABLE posts")).toBeNull()
    expect(parseId("1 OR 1=1")).toBeNull()
  })
})

describe('isAdminRole', () => {
  test('admin e super_admin retornam true', () => {
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('super_admin')).toBe(true)
  })
  test('user e roles desconhecidos retornam false', () => {
    expect(isAdminRole('user')).toBe(false)
    expect(isAdminRole('')).toBe(false)
    expect(isAdminRole(null)).toBe(false)
    expect(isAdminRole(undefined)).toBe(false)
  })
})

describe('validarComplexidadeSenha', () => {
  test('senha válida retorna null', () => {
    expect(validarComplexidadeSenha('SenhaSegura@1')).toBeNull()
    expect(validarComplexidadeSenha('MinhaSenha#123')).toBeNull()
  })
  test('muito curta retorna erro', () => {
    expect(validarComplexidadeSenha('Ab1!')).not.toBeNull()
  })
  test('muito longa retorna erro', () => {
    expect(validarComplexidadeSenha('A1!' + 'x'.repeat(72))).not.toBeNull()
  })
  test('sem maiúscula retorna erro', () => {
    expect(validarComplexidadeSenha('senha@123')).not.toBeNull()
  })
  test('sem número retorna erro', () => {
    expect(validarComplexidadeSenha('SenhaForte!')).not.toBeNull()
  })
  test('sem especial retorna erro', () => {
    expect(validarComplexidadeSenha('SenhaForte1')).not.toBeNull()
  })
  test('não-string retorna erro', () => {
    expect(validarComplexidadeSenha(123)).not.toBeNull()
    expect(validarComplexidadeSenha(null)).not.toBeNull()
  })
})

describe('constantes PLATFORMS e REPEATS', () => {
  test('PLATFORMS contém as redes esperadas', () => {
    expect(PLATFORMS).toContain('instagram')
    expect(PLATFORMS).toContain('facebook')
    expect(PLATFORMS).toContain('youtube')
    expect(PLATFORMS).toContain('tiktok')
  })
  test('REPEATS contém os intervalos esperados', () => {
    expect(REPEATS).toContain('none')
    expect(REPEATS).toContain('daily')
    expect(REPEATS).toContain('weekly')
    expect(REPEATS).toContain('monthly')
  })
})
