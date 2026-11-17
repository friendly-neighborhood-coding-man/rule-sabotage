from pathlib import Path
root=Path(__file__).parent/'client'
html=(root/'index.html').read_text(encoding='utf8')
css=(root/'style.css').read_text(encoding='utf8')
css=css.replace("@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');",'')
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
for script in ['engine.js','guard.js','adapters.js','ui.js']:
 html=html.replace(f'<script src="{script}"></script>','<script>'+(root/script).read_text(encoding='utf8')+'</script>')
out=Path(__file__).parent/'rule-sabotage-v2-offline-demo.html';out.write_text(html,encoding='utf8')
print('Created',out,len(html))
