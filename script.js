document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();const btn=form.querySelector('button');const old=btn.innerHTML;btn.innerHTML='Tack! Vi hör av oss ✓';btn.disabled=true;setTimeout(()=>{btn.innerHTML=old;btn.disabled=false;form.reset()},3500)}));
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});
document.querySelectorAll('section:not(:first-child)').forEach(el=>observer.observe(el));
