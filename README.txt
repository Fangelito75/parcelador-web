Parcelador web (Leaflet) - v4

Añadido:
- Herramienta de medición lineal (botón "Medir distancia"):
  dibuja una línea y muestra su longitud como etiqueta.
- Botón "Borrar / reiniciar" para empezar de cero (borra polígono, resultados, medidas).
- Restricciones de nº de parcelas (mínimo y máximo):
  - 0 = sin límite.
  - En auto-orientación, solo acepta soluciones que cumplan el rango.
  - En manual, da error si el resultado queda fuera de rango.

Archivos:
- index.html
- styles.css
- js/basemaps.js
- js/geometry.js
- js/export.js
- js/app.js

Notas:
- Dependencias vía CDN (internet necesario).


v5: Añadido control deslizante (range) para ajustar el ángulo manual de 0 a 179°.


v6: Añadido mover bloque (handle arrastrable) y distancia mínima entre 2 parcelas (modo + click en 2 parcelas).


v7: Añadido logo IRNAS fijo en la esquina superior izquierda.


v8: Logo movido a la esquina inferior izquierda.
