# API Enterprise - Postiz

## Ce este `/enterprise`

`/enterprise` nu este o pagină web și nu are un ecran de administrare. Este prefixul pentru câteva endpointuri API folosite atunci când Postiz este integrat într-o altă aplicație SaaS, de exemplu pentru white-label sau pentru un portal extern.

În această versiune există următoarele endpointuri:

| Metodă | Endpoint | Scop |
| --- | --- | --- |
| `POST` | `/api/enterprise/create-user` | Creează un utilizator și organizația lui în Postiz |
| `POST` | `/api/enterprise/url` | Inițiază conectarea unui canal social prin OAuth |
| `POST` | `/api/enterprise/delete-channel` | Șterge un canal și postările asociate |

Prefixul `/api` este folosit când cererea trece prin interfața web. În dezvoltare, dacă backendul este accesibil direct pe portul `3000`, prefixul poate fi omis:

```text
http://localhost:4007/api/enterprise/create-user
http://localhost:3000/enterprise/create-user
```

Accesarea directă a `GET /enterprise` sau `GET /api/enterprise` nu deschide o pagină și nu este definită ca rută. Pentru acest controller trebuie folosită metoda `POST` și una dintre rutele de mai sus.

## Crearea unui utilizator prin API

Endpointul este:

```text
POST /api/enterprise/create-user
```

Corpul cererii trebuie să conțină un câmp `params`. Valoarea acestuia este un JWT semnat cu aceeași valoare `JWT_SECRET` configurată în Postiz.

Payload-ul JWT acceptă următoarele câmpuri:

```json
{
  "id": "client-user-123",
  "name": "Andrei Popescu",
  "saasName": "clientapp",
  "email": "andrei@example.com"
}
```

Exemplu de generare a tokenului în Node.js:

```js
import { sign } from 'jsonwebtoken';

const params = sign(
  {
    id: 'client-user-123',
    name: 'Andrei Popescu',
    saasName: 'clientapp',
    email: 'andrei@example.com',
  },
  process.env.JWT_SECRET
);
```

Exemplu de cerere către o instalare locală Docker:

```js
const response = await fetch(
  'http://localhost:4007/api/enterprise/create-user',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
  }
);

const result = await response.json();
console.log(result);
```

La succes, răspunsul conține identificatorul organizației și cheia API a acesteia:

```json
{
  "id": "organization-id",
  "apiKey": "encrypted-api-key"
}
```

## Ce creează endpointul

La fiecare cerere validă, Postiz creează:

- o organizație nouă;
- un utilizator local activ;
- asocierea utilizatorului cu organizația în rolul `SUPERADMIN` al organizației;
- un abonament intern `ULTIMATE`, lifetime, cu `1000000` de canale;
- o cheie API pentru organizație.

Emailul local este construit cu aliasul `+saasName`. De exemplu, `andrei@example.com` și `clientapp` devin `andrei+clientapp@example.com`. Parola este generată aleatoriu și nu este returnată de endpoint; integrarea Enterprise trebuie să controleze autentificarea utilizatorului în aplicația externă.

## Important despre `SUPERADMIN`

Rolul `SUPERADMIN` creat aici este rolul principal în organizația nouă. Nu setează automat câmpul global `User.isSuperAdmin`.

Prin urmare, utilizatorul creat prin acest endpoint nu primește automat panoul global de administrare al platformei, căutarea tuturor utilizatorilor sau funcția de impersonare. Acestea depind de `isSuperAdmin = true` în baza de date și sunt separate de rolul organizației.

## Securitate

Endpointul nu folosește autentificare de sesiune; autorizația se bazează pe semnătura JWT. Din acest motiv:

- `JWT_SECRET` trebuie păstrat secret și nu trebuie trimis în browser;
- aplicația externă și Postiz trebuie să folosească același secret;
- endpointul trebuie apelat numai prin HTTPS în producție;
- tokenurile ar trebui să aibă o durată de viață scurtă;
- cheia API primită trebuie păstrată secretă, deoarece identifică organizația creată.

În implementarea actuală, un token JWT valid poate crea o organizație nouă. Nu folosi acest endpoint pentru înregistrarea publică obișnuită fără un strat suplimentar de autorizare și limitare.

## Răspunsuri de eroare

Implementarea actuală transformă unele erori în răspunsuri JSON cu status HTTP `200`:

```json
{ "success": false }
```

sau:

```json
{ "create": false }
```

Aplicația client trebuie să verifice și conținutul răspunsului, nu doar statusul HTTP.

## Fișiere relevante

- `apps/backend/src/api/routes/enterprise.controller.ts` - endpointurile Enterprise;
- `libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts` - logica de creare a utilizatorului și organizației;
- `libraries/helpers/src/auth/auth.service.ts` - semnarea și verificarea JWT;
- `docker-compose.yaml` - URL-ul public local și variabila `JWT_SECRET`.
