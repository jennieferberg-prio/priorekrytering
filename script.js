const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});
document.querySelectorAll('section:not(:first-child)').forEach(el=>observer.observe(el));
document.querySelectorAll('.js-contact').forEach(link=>{try{const value=atob(link.dataset.value);link.textContent=link.dataset.kind==='phone'?value.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/,'$1 $2 $3 $4'):value;link.href=(link.dataset.kind==='phone'?'tel:':'mailto:')+value}catch(error){link.removeAttribute('href')}});
