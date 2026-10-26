# Dibuja las imágenes de origen de los íconos y la pantalla de inicio (assets/) con los logos oficiales,
# sin modificarlos ni recolorearlos: solo se ubican sobre el fondo tinta (#15181D) de Síguelo.
# Después: npm run iconos (genera todos los tamaños para Android, iOS y la PWA).
from PIL import Image, ImageFilter

TINTA = (21, 24, 29, 255)
pin = Image.open('recursos/logo-pin-grande.png').convert('RGBA')
txt = Image.open('recursos/logo-texto-blanco.png').convert('RGBA')


def pin_alto(h):
    p = pin.resize((round(pin.width * h / pin.height), h), Image.LANCZOS)
    return p.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))


def centrado(n, fondo, p, dy=0):
    i = Image.new('RGBA', (n, n), fondo)
    i.alpha_composite(p, ((n - p.width) // 2, (n - p.height) // 2 + dy))
    return i


centrado(1024, TINTA, pin_alto(600), 8).convert('RGB').save('assets/icon-only.png')
centrado(1024, (0, 0, 0, 0), pin_alto(470), 6).save('assets/icon-foreground.png')
Image.new('RGB', (1024, 1024), TINTA[:3]).save('assets/icon-background.png')

# Pantalla de inicio: logo «Síguelo GPS + On Rent» apilado, de letras blancas (aprobado por Pablo el 26-oct), centrado
# sobre el fondo tinta. Antes iba el logo horizontal oficial solo (pin + «IGUELO · GPS»). El dibujo no se toca: solo se
# escala. Las apps con la marca del cliente cambian esta pantalla por la suya (scripts/app-propia.mjs).
lk = Image.open('recursos/siguelo-onrent-b-oscuro.png').convert('RGBA')
ANCHO = 860
lk = lk.resize((ANCHO, round(lk.height * ANCHO / lk.width)), Image.LANCZOS)
for nombre in ('splash.png', 'splash-dark.png'):
    s = Image.new('RGBA', (2732, 2732), TINTA)
    s.alpha_composite(lk, ((2732 - lk.width) // 2, (2732 - lk.height) // 2))
    s.convert('RGB').save(f'assets/{nombre}')
print(f'Listo (logo de inicio: {ANCHO} px de ancho)')
