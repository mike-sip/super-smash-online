/** Point d'entrée de Fracas. */
import './style.css';

const ui = document.getElementById('ui')!;
const h = document.createElement('h1');
h.className = 'logo';
h.textContent = 'Fracas';
ui.append(h);
