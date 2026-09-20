// Заявка на пробное занятие.
//
// Отправка вынесена в sendLead: сейчас она пишет в консоль, в бою на её место
// встаёт fetch к своей функции. Всё остальное — проверка полей и ответ
// человеку — от этого не зависит.

export async function sendLead(data) {
  console.log('sendLead', data);
  return { ok: true };
}

const form = document.getElementById('lead');
const msg = document.getElementById('lead-msg');

if (form) {
  const digits = (s) => s.replace(/\D/g, '');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'lead__msg';

    const data = Object.fromEntries(new FormData(form).entries());
    const problems = [];
    if (!data.parent || data.parent.trim().length < 2) problems.push(['parent', 'Как к вам обращаться?']);
    if (digits(data.phone || '').length < 10) problems.push(['phone', 'Нужен телефон из 10 цифр — по нему перезвонят']);
    if (!data.child || data.child.trim().length < 2) problems.push(['child', 'Имя ребёнка']);
    const age = Number(data.childAge);
    if (!Number.isInteger(age) || age < 2 || age > 18) problems.push(['childAge', 'Возраст ребёнка от 2 до 18']);

    for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');

    if (problems.length) {
      const [name, text] = problems[0];
      const field = form.elements[name];
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      msg.className = 'lead__msg lead__msg--bad';
      msg.textContent = text;
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    msg.textContent = 'Отправляем…';

    try {
      const res = await sendLead({
        groupId: data.groupId,
        parent: data.parent.trim(),
        phone: data.phone.trim(),
        child: data.child.trim(),
        childAge: age,
        callTime: data.callTime,
        page: location.pathname,
        sentAt: new Date().toISOString()
      });
      if (!res.ok) throw new Error('reject');
      form.hidden = true;
      msg.className = 'lead__msg lead__msg--good';
      msg.textContent = `Заявка принята. Позвоним ${data.callTime === 'в любое время' ? 'в ближайшее рабочее время' : data.callTime.replace(/,.*/, '')} на ${data.phone.trim()}. Это демонстрационный сайт: заявка ушла в консоль браузера, а не в центр.`;
      msg.hidden = false;
      form.after(msg);
    } catch {
      button.disabled = false;
      msg.className = 'lead__msg lead__msg--bad';
      msg.textContent = 'Не отправилось. Попробуйте ещё раз через минуту.';
    }
  });
}
