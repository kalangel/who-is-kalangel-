/// <reference types="vite/client" />

// Шейдеры лежат отдельными .glsl-файлами и подключаются как текст: так
// работают подсветка, форматирование и номера строк в ошибках компиляции.
declare module '*.glsl?raw' {
  const src: string
  export default src
}
