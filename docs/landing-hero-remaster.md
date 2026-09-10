# Arte do hero — acabamento e posicionamento

Arquivo em uso: `public/ecoo-phone-premium-remastered-v2.png`.
Referência preservada: `public/ecoo-phone-premium-icons-2x-callout-right.png`.

## Edição

Edição feita com a ferramenta integrada `image_gen`, seguindo a skill imagegen, para refinar materiais, contornos, iluminação e legibilidade, sem redesenhar a interface. A saída efetiva é PNG RGB de **1122 × 1402 px**; embora o prompt solicite um master maior, não se deve anunciar esta saída como 2K nem confundir ampliação CSS com resolução adicional.

## Integração

- Em viewports a partir de 1200 px: largura de 108% da coluna, limitada a 648 px (antes 600 px), com centro deslocado 50 px para a esquerda.
- Em telas menores: preservado o posicionamento responsivo anterior, sem deslocamento que corte os ícones.
- Mantidos o fundo creme, a composição e os textos. Não substituir o hero inteiro por uma imagem.
- O fundo de estúdio é integrado com `mix-blend-mode: darken`. A sobreposição SVG preserva o branco da tela usando a mesma imagem, não outra interface.
- O recorte interno da tela segue as coordenadas do asset 1122 × 1402; revisar se uma futura arte mudar a perspectiva ou a silhueta.
- Sem novas dependências. Não remover as versões anteriores da arte.

## Prompt utilizado (ferramenta integrada, sem CLI)

```text
Use case: precise-object-edit.
Asset type: existing Ecoo Mídia landing hero smartphone advertising artwork, photorealistic quality remaster.
Image 1 is the EDIT TARGET, not inspiration. Refine this exact image, do not create a new phone design. Preserve the exact composition, silhouette, viewpoint, object positions and relative sizes. Preserve the entire phone and all four large floating Instagram, Facebook, TikTok and YouTube icons with their existing overlap behind the phone. Keep the handwritten brown callout and arrow in the upper right in exactly the same position.
Primary change: materially improve photorealism and fine-detail quality. Create a high-resolution 2048 x 2560 portrait master with genuinely detailed clean antialiasing, crisp legible screen lettering, smooth artifact-free tonal gradients and no dead-looking pixels. Retain the existing dark champagne titanium chassis but resolve its fine brushed metal finish, controlled thin edge highlights, precise antenna seams, realistic side-button machining and bottom speaker/USB-C port detail. Separate the black bezel, shallow front glass and metal frame convincingly. Improve physically plausible subtle glass reflections, do not obscure the screen. Preserve a premium believable studio photograph look, not plastic or overprocessed CGI. Floating logos retain their existing brand colors and 3D dimensions; improve bevel precision, subtle satin specular falloff, depth and ambient occlusion. Upper-left softbox lighting, soft warm bounce, delicate rim highlights. Soft realistic diffuse cast shadows, continuous gradients, not black smudges or halos.
Background: minimal warm off-white #F7F4EA, no texture, no props, no horizon. All background lighting must settle smoothly to uniform #F7F4EA at the outer empty margins. Preserve soft shadows gently fading into the background. Do NOT add checkerboard or transparent-pattern pixels. No squared lighting panels, no rectangular halo.
Text/UI invariants verbatim: "9:41"; "Ideias se tornam resultados" / "quando você posta."; outlined gold heart; existing beige abstract three-circle graphic; "Instagram" and "Postado"; "Facebook" and "Agendado"; "TikTok" and "Agendado"; "YouTube" and "Agendado"; small gold checked circles; gold button "Publicar" with the existing right arrow; bottom "Criar", "Calendário", "Estatísticas" with existing icons. Handwritten callout exactly "4 redes" / "em um só" / "lugar!" and the same curved arrow.
Absolutely no redesign of screen content. Do not enlarge, move, rotate or crop any object relative to the canvas. Do not change any wording, invent buttons or add elements. Do not add grain, fake scratches, exaggerated reflections, glow, lens blur over text, oversharpened halos, oversaturated colors or toy-like plastic. Improve material realism, clarity and rendering quality ONLY. This must remain the same approved artwork, professionally remastered.
```

