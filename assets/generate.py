#!/usr/bin/env python3
"""Genera la marca de QUA en SVG (concepto elegido 2026-10-14: la onda de voz atraviesa
el anillo y el punto del centro es el elemento anclado). Misma familia que Zygos: trazo
fino uniforme, círculos sólidos, monocromo. Uso: python3 assets/generate.py"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# Alturas de las barras de afuera, del borde hacia el anillo (se espejan del otro lado).
OUTER = [0.22, 0.42, 0.78, 1.0, 0.58]


def mark(cx, cy, r, color, sw):
    """Anillo + punto central + dos barras chicas adentro + barras simétricas afuera."""
    unit = r * 0.9            # alto de la barra más alta
    step = r * 0.30           # separación entre barras
    parts = [
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="{sw}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.2:.2f}" fill="{color}"/>',
    ]

    def bar(x, h):
        parts.append(
            f'<line x1="{x:.2f}" y1="{cy-h/2:.2f}" x2="{x:.2f}" y2="{cy+h/2:.2f}" '
            f'stroke="{color}" stroke-width="{sw*1.15:.2f}" stroke-linecap="round"/>'
        )

    for side in (-1, 1):
        bar(cx + side * r * 0.5, unit * 0.32)                 # barras de adentro
        start = cx + side * (r + step * 0.85)
        for i, k in enumerate(reversed(OUTER)):              # del anillo hacia afuera
            bar(start + side * i * step, unit * k)
    left = cx - (r + step * 0.85) - (len(OUTER) - 1) * step
    return "".join(parts), left, 2 * cx - left


def wordmark_letters(x, base, h, gap, sw, color):
    """Q U A de trazo fino dibujadas a mano: no depende de ninguna fuente."""
    r = h / 2
    cx, cy = x + r, base - r
    out = [
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="{sw}"/>',
        f'<path d="M{cx+r*0.38:.1f},{cy+r*0.38:.1f} L{cx+r*1.02:.1f},{cy+r*1.02:.1f}" stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>',
    ]
    ux, uw = x + h + gap, h * 0.82
    out.append(f'<path d="M{ux},{base-h} V{base-uw/2} A{uw/2},{uw/2} 0 0 0 {ux+uw},{base-uw/2} V{base-h}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>')
    ax, aw = ux + uw + gap, h * 0.95
    out.append(f'<path d="M{ax},{base} L{ax+aw/2},{base-h} L{ax+aw},{base} M{ax+aw*0.21},{base-h*0.36} H{ax+aw*0.79}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')
    return "".join(out), (h + gap + uw + gap + aw)


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>\n'


def write(name, content):
    with open(os.path.join(HERE, name), "w") as f:
        f.write(content)


for suffix, color in (("", "#111111"), ("-dark", "#ECECEC")):
    body, _, _ = mark(451, 256, 92, color, 7)
    write(f"logo{suffix}.svg", svg(902, 512, body))

    body, _, _ = mark(394, 140, 64, color, 5)
    lh, gap = 44, 50
    _, width = wordmark_letters(0, 0, lh, gap, 3.6, color)
    letters, _ = wordmark_letters(394 - width / 2, 300, lh, gap, 3.6, color)
    write(f"wordmark{suffix}.svg", svg(789, 340, body + letters))

# Ícono cuadrado (extensión, avatar): solo anillo, punto y barras de adentro, sobre blanco.
icon = [
    '<rect width="512" height="512" rx="112" fill="#FFFFFF"/>',
    '<circle cx="256" cy="256" r="150" fill="none" stroke="#111111" stroke-width="22"/>',
    '<circle cx="256" cy="256" r="40" fill="#111111"/>',
]
for x in (256 - 92, 256 + 92):
    icon.append(f'<line x1="{x}" y1="214" x2="{x}" y2="298" stroke="#111111" stroke-width="24" stroke-linecap="round"/>')
write("icon.svg", svg(512, 512, "".join(icon)))
