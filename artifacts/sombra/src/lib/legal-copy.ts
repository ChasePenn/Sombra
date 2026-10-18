import type { Lang } from './copy';

export type LegalDoc = { title: string; updated: string; intro: string; sections: Array<{ id: string; h: string; p: string[] }> };

const CONTACT_URL = 'https://github.com/ChasePenn/Sombra/issues';
export const legalContactUrl = CONTACT_URL;

// Keep these in step with what the app really does. If a data flow changes, update the page and the date.
const privacy: Record<Lang, LegalDoc> = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated October 18, 2026',
    intro: 'sombra is a free heat-safety app made in Phoenix. This page explains what information the app uses, where it goes, and how to delete it. You can use sombra without an account.',
    sections: [
      { id: 'phone', h: 'What stays on your phone', p: [
        'Your heat profile and the people you check on are saved only on your phone. They are never sent to our server.',
        'Photos of your spot are checked on the phone itself. They are never uploaded or stored anywhere else.',
      ] },
      { id: 'location', h: 'Your location', p: [
        'When you use your location, sombra rounds it to about half a mile before sending it to our server. The server uses that rounded spot to look up the forecast and heat alerts for your area, and to find cool places nearby. Your exact position stays on your phone.',
      ] },
      { id: 'guest', h: 'Using sombra without an account', p: [
        'As a guest, your plans and check-ins are saved in this browser only. Clearing the browser\'s site data deletes them.',
      ] },
      { id: 'account', h: 'If you create an account', p: [
        'Sign-in is handled by Clerk, which stores your email address and keeps you signed in with a cookie.',
        'Your profile, your group, your saved plans and your check-ins are stored on our server so they show up on all your devices. Only you can see them.',
      ] },
      { id: 'checkins', h: 'Check-in replies', p: [
        'When a check-in is not an emergency, your first name, the symptoms you chose and any note you wrote are sent to our server and to Google Gemini so the reply can be worded for you. Google\'s Gemini API terms apply to that data, so leave out anything you would not want shared.',
        'Emergency answers never use AI. Fixed safety rules decide them on your phone.',
      ] },
      { id: 'push', h: 'Reminders when sombra is closed', p: [
        'If you turn these on, our server keeps a push address for your device, your reminder times and the rounded area used for heat warnings. It never receives the names of the people you check on. Your phone adds the names when a reminder arrives.',
      ] },
      { id: 'others', h: 'Other services your browser contacts', p: [
        'Map tiles come from CARTO and OpenStreetMap, and fonts come from Google Fonts. Like any website, these services can see your device\'s IP address.',
        'sombra has no ads and no analytics, and it does not use tracking cookies.',
      ] },
      { id: 'delete', h: 'Deleting your data', p: [
        'In Settings, Delete my account and data removes your account and everything stored with it from our server. Turning off closed-app reminders removes your push address. To remove guest data, clear this site\'s data in your browser.',
      ] },
      { id: 'children', h: 'Children', p: [
        'School mode is meant for coaches and teams. Students can use sombra as guests without giving any personal information. We do not knowingly create accounts for children under 13. If you believe a child under 13 has made an account, contact us and we will delete it.',
      ] },
      { id: 'contact', h: 'Changes and questions', p: [
        'If this policy changes, the date at the top changes too. For questions or requests, open an issue on sombra\'s GitHub page.',
      ] },
    ],
  },
  es: {
    title: 'Política de privacidad',
    updated: 'Última actualización: 18 de octubre de 2026',
    intro: 'sombra es una app gratuita de seguridad contra el calor hecha en Phoenix. Esta página explica qué información usa la app, a dónde va y cómo borrarla. Puedes usar sombra sin cuenta.',
    sections: [
      { id: 'phone', h: 'Lo que se queda en tu teléfono', p: [
        'Tu perfil de calor y las personas que revisas se guardan solo en tu teléfono. Nunca se envían a nuestro servidor.',
        'Las fotos de tu lugar se revisan en el mismo teléfono. Nunca se suben ni se guardan en otro lugar.',
      ] },
      { id: 'location', h: 'Tu ubicación', p: [
        'Cuando usas tu ubicación, sombra la redondea a como media milla antes de enviarla a nuestro servidor. El servidor usa ese punto redondeado para buscar el pronóstico y las alertas de calor de tu zona, y para encontrar lugares frescos cerca. Tu ubicación exacta se queda en tu teléfono.',
      ] },
      { id: 'guest', h: 'Usar sombra sin cuenta', p: [
        'Como invitado, tus planes y registros se guardan solo en este navegador. Si borras los datos del sitio en el navegador, se borran.',
      ] },
      { id: 'account', h: 'Si creas una cuenta', p: [
        'El inicio de sesión lo maneja Clerk, que guarda tu correo electrónico y usa una cookie para mantener tu sesión abierta.',
        'Tu perfil, tu grupo, tus planes y tus registros se guardan en nuestro servidor para que aparezcan en todos tus dispositivos. Solo tú puedes verlos.',
      ] },
      { id: 'checkins', h: 'Respuestas a los registros', p: [
        'Cuando un registro no es una emergencia, tu nombre, los síntomas que elegiste y la nota que escribiste se envían a nuestro servidor y a Google Gemini para redactar la respuesta. A esos datos se aplican los términos de la API de Gemini de Google, así que no escribas nada que no quieras compartir.',
        'Las respuestas de emergencia nunca usan IA. Las deciden reglas de seguridad fijas en tu teléfono.',
      ] },
      { id: 'push', h: 'Recordatorios con sombra cerrada', p: [
        'Si los activas, nuestro servidor guarda una dirección de notificaciones para tu dispositivo, las horas de tus recordatorios y la zona redondeada para las alertas de calor. Nunca recibe los nombres de las personas que revisas. Tu teléfono agrega los nombres cuando llega el recordatorio.',
      ] },
      { id: 'others', h: 'Otros servicios que contacta tu navegador', p: [
        'Los mapas vienen de CARTO y OpenStreetMap, y las fuentes de Google Fonts. Como cualquier sitio web, estos servicios pueden ver la dirección IP de tu dispositivo.',
        'sombra no tiene anuncios ni analíticas, y no usa cookies de rastreo.',
      ] },
      { id: 'delete', h: 'Borrar tus datos', p: [
        'En Ajustes, Eliminar mi cuenta y mis datos borra tu cuenta y todo lo guardado con ella en nuestro servidor. Si apagas los recordatorios con la app cerrada, se borra tu dirección de notificaciones. Para borrar los datos de invitado, borra los datos de este sitio en tu navegador.',
      ] },
      { id: 'children', h: 'Niños', p: [
        'El modo Escuela es para entrenadores y equipos. Los estudiantes pueden usar sombra como invitados sin dar información personal. No creamos a sabiendas cuentas para menores de 13 años. Si crees que un menor de 13 años creó una cuenta, contáctanos y la borraremos.',
      ] },
      { id: 'contact', h: 'Cambios y preguntas', p: [
        'Si esta política cambia, también cambia la fecha de arriba. Para preguntas o solicitudes, abre un reporte (issue) en la página de sombra en GitHub.',
      ] },
    ],
  },
};

const terms: Record<Lang, LegalDoc> = {
  en: {
    title: 'Terms of Use',
    updated: 'Last updated October 18, 2026',
    intro: 'By using sombra you agree to these terms. They are short, so please read them.',
    sections: [
      { id: 'what', h: 'What sombra is', p: [
        'sombra gives heat-safety guidance based on weather forecasts and published guidelines, including OSHA\'s heat stress method and the U.S. Army heat guide TB MED 507. It is general information and not medical advice.',
      ] },
      { id: 'judgment', h: 'Use your own judgment', p: [
        'Forecasts can be wrong, and every body handles heat differently. If you feel sick, stop and get somewhere cool, even if your plan says it is fine. In an emergency, call 911.',
        'sombra does not replace an employer\'s heat illness prevention plan or a school\'s safety rules.',
      ] },
      { id: 'places', h: 'Cooling centers and places', p: [
        'Hours and locations come from the Heat Relief Network and OpenStreetMap, and they can change without notice. Call ahead when you can.',
      ] },
      { id: 'account', h: 'Your account', p: [
        'Keep your sign-in safe. You can delete your account at any time in Settings. We may remove accounts that abuse the service.',
      ] },
      { id: 'use', h: 'Fair use', p: [
        'Do not try to overload or break the service, and do not use it to collect information about other people.',
      ] },
      { id: 'warranty', h: 'No warranty', p: [
        'sombra is free and provided "as is." We work to keep it accurate and running, but we cannot promise it will always be available or correct.',
      ] },
      { id: 'liability', h: 'Limits on liability', p: [
        'To the extent the law allows, sombra and its developer are not responsible for losses that come from using or relying on the app. You stay responsible for your own safety decisions.',
      ] },
      { id: 'sources', h: 'Data from others', p: [
        'Weather data comes from Open-Meteo and alerts from the National Weather Service. Map data is © OpenStreetMap contributors, with map tiles by CARTO. Their own terms apply to their data.',
      ] },
      { id: 'changes', h: 'Changes and contact', p: [
        'We may update these terms, and the date at the top shows the current version. If you keep using sombra after a change, you accept the new terms. These terms are governed by the laws of Arizona. For questions, open an issue on sombra\'s GitHub page.',
      ] },
    ],
  },
  es: {
    title: 'Términos de uso',
    updated: 'Última actualización: 18 de octubre de 2026',
    intro: 'Al usar sombra aceptas estos términos. Son cortos, así que léelos por favor.',
    sections: [
      { id: 'what', h: 'Qué es sombra', p: [
        'sombra da orientación para protegerse del calor basada en pronósticos del tiempo y guías publicadas, como el método de estrés por calor de OSHA y la guía de calor del Ejército de EE. UU., TB MED 507. Es información general y no es consejo médico.',
      ] },
      { id: 'judgment', h: 'Usa tu propio criterio', p: [
        'Los pronósticos pueden fallar, y cada cuerpo aguanta el calor de forma distinta. Si te sientes mal, detente y busca un lugar fresco, aunque tu plan diga que todo está bien. En una emergencia, llama al 911.',
        'sombra no reemplaza el plan de prevención de enfermedades por calor de un empleador ni las reglas de seguridad de una escuela.',
      ] },
      { id: 'places', h: 'Centros de enfriamiento y lugares', p: [
        'Los horarios y lugares vienen de la Red de Alivio del Calor y de OpenStreetMap, y pueden cambiar sin aviso. Llama antes cuando puedas.',
      ] },
      { id: 'account', h: 'Tu cuenta', p: [
        'Protege tu inicio de sesión. Puedes borrar tu cuenta cuando quieras en Ajustes. Podemos quitar cuentas que abusen del servicio.',
      ] },
      { id: 'use', h: 'Uso justo', p: [
        'No intentes sobrecargar ni dañar el servicio, y no lo uses para reunir información sobre otras personas.',
      ] },
      { id: 'warranty', h: 'Sin garantía', p: [
        'sombra es gratis y se ofrece "tal cual". Trabajamos para que sea correcta y funcione, pero no podemos prometer que siempre esté disponible o sea exacta.',
      ] },
      { id: 'liability', h: 'Límites de responsabilidad', p: [
        'En la medida que la ley lo permita, sombra y su desarrollador no son responsables de pérdidas por usar la app o confiar en ella. Tú sigues siendo responsable de tus decisiones de seguridad.',
      ] },
      { id: 'sources', h: 'Datos de otros', p: [
        'Los datos del tiempo vienen de Open-Meteo y las alertas del Servicio Meteorológico Nacional. Los datos del mapa son © colaboradores de OpenStreetMap, con mapas de CARTO. Sus propios términos se aplican a sus datos.',
      ] },
      { id: 'changes', h: 'Cambios y contacto', p: [
        'Podemos actualizar estos términos, y la fecha de arriba muestra la versión actual. Si sigues usando sombra después de un cambio, aceptas los nuevos términos. Estos términos se rigen por las leyes de Arizona. Para preguntas, abre un reporte (issue) en la página de sombra en GitHub.',
      ] },
    ],
  },
};

export const legalCopy = { privacy, terms };
export const legalUi: Record<Lang, { contact: string; privacy: string; terms: string; agree: string }> = {
  en: { contact: 'sombra on GitHub', privacy: 'Privacy Policy', terms: 'Terms of Use', agree: 'By creating an account you agree to the' },
  es: { contact: 'sombra en GitHub', privacy: 'Política de privacidad', terms: 'Términos de uso', agree: 'Al crear una cuenta aceptas los' },
};
