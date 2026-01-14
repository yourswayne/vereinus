# Projektdokumentation: Vereinus

## Vorwort
Diese Projektdokumentation beschreibt die Ziele, die technische Umsetzung sowie die erzielten Ergebnisse der mobilen Vereins-App **Vereinus**.  
Sie dient als Grundlage für die Bewertung, Weiterentwicklung und den Betrieb des Systems.  
Erstellt von **Wayne Vincent Abiva** – Zuständig für: **Frontend, Backend, Projektmanagement, Tests**.

## Danksagung
Ich bedanke mich bei **[Name/Institution]** für die fachliche Unterstützung, den Zugang zu Testdaten und die Möglichkeit, dieses Projekt umzusetzen.

## Abstract
Vereinus ist eine mobile Anwendung zur Organisation von Vereinsaktivitäten mit Fokus auf Kommunikation, Terminverwaltung und Aufgabenverteilung.  
Die App bietet Rollen (Direktor/Lehrer/Schüler), Chat mit Medien, Ankündigungen, Aufgaben, Übungen und einen Kalender mit persönlicher sowie vereinsweiter Sichtbarkeit.  
Technisch basiert das Frontend auf Expo/React Native, während das Backend über Supabase (PostgreSQL, Auth, Storage, Realtime) realisiert ist.

## Inhaltsverzeichnis
1. Vorwort  
2. Danksagung  
3. Abstract  
4. Impressum  
5. Projektmanagement  
   5.1 Projektauftrag (wird separat eingefügt)  
   5.2 Projektstrukturplan (wird separat eingefügt)  
6. Technisches Konzept  
   6.1 Programmiersprachen  
   6.2 Frontend (Technologien)  
   6.3 Backend (Technologien)  
   6.4 Umsetzung und Ergebnisse  
       6.4.1 Frontend  
       6.4.2 Backend  
7. Abbildungsverzeichnis  
8. Quellenverzeichnis

## Impressum
Autor: **Wayne Vincent Abiva**  
Institution: **HTL Dornbirn**  
Zuständigkeiten: **Frontend, Backend, Projektmanagement, Tests**  
Adresse: [Straße, PLZ, Ort]  
E-Mail: [E-Mail]  
Telefon: [optional]  
Erstellt am: **2025/2026**  

## Projektmanagement
### Projektauftrag (mach ich selbst)
[Platzhalter – Projektauftrag wird vom Autor eingefügt.]  
Datei: `projektunterlagen/Projektauftrag.pdf` (Platzhalter)

### Projektstrukturplan (mach ich selbst)
[Platzhalter – Projektstrukturplan wird vom Autor eingefügt.]  
Datei: `projektunterlagen/Projektstrukturplan.png` oder `projektunterlagen/Projektstrukturplan.pdf` (Platzhalter)

## Technisches Konzept
### Programmiersprachen
- TypeScript/JavaScript (App-Logik, UI)
- SQL (Datenbankfunktionen, Trigger, RLS-Policies)
- JSON (Konfiguration, Datenaustausch)

### Frontend (Technologien)
- **Expo** als Build- und Laufzeitumgebung
- **React Native** für die mobile UI
- **Expo Router** (file-based routing)
- **React Navigation** (Tabs und Navigation)
- **AsyncStorage** als Offline-/Fallback-Speicher
- Medien-/System-Module: `expo-image-picker`, `expo-document-picker`, `expo-video`, `expo-clipboard`

### Backend (Technologien)
- **Supabase** (PostgreSQL, Auth, Storage, Realtime)
- **RLS (Row Level Security)** zur Zugriffskontrolle
- **RPC/SQL-Funktionen** (z. B. `has_org_role`, `create_invite`, `redeem_invite`, `delete_org_cascade`)
- **Storage Buckets** für Medien (z. B. Chat-/Vereinsbilder, Aufgaben-Anhänge)

### Umsetzung und Ergebnisse
#### Frontend
Die App ist als Tabs-basierte Oberfläche mit Dunkel-Design umgesetzt und beinhaltet folgende Hauptbereiche:
- **Login/Registrierung**: Anmeldung mit E-Mail oder Benutzername
- **Startseite (Verein)**: Überblick, Vereinslogo, Navigation zu Funktionen
- **Chat**: Gruppenbasierter Chat mit Bild/Datei/Video-Uploads und Realtime-Updates
- **Ankündigungen/News**: Vereins- oder gruppenweite Ankündigungen, optionaler Kalendereintrag
- **Aufgaben & Abgaben**: Aufgabenverwaltung mit Abgaben (inkl. Anhänge)
- **Übungen**: Übungen mit Text und Medien
- **Kalender**: persönliche Termine + Vereins-Termine (rollenbasiert editierbar)
- **Einstellungen**: Profilpflege, Einladungen, rollenabhängige Verwaltungsfunktionen

Abbildungen (Platzhalter, Dateien unter `projektunterlagen/abbildungen/`):
![Abbildung 3: Login/Registrierung](projektunterlagen/abbildungen/03_login.png)
![Abbildung 4: Startseite mit Vereinslogo](projektunterlagen/abbildungen/04_startseite.png)
![Abbildung 5: Kalender (Wochenansicht + Termin-Modal)](projektunterlagen/abbildungen/05_kalender.png)
![Abbildung 6: Chat (Gruppenliste + Chatansicht)](projektunterlagen/abbildungen/06_chat.png)
![Abbildung 7: Aufgabenliste / Aufgaben-Detail](projektunterlagen/abbildungen/07_aufgaben.png)
![Abbildung 8: Ankündigungen / News](projektunterlagen/abbildungen/08_ankuendigungen.png)
![Abbildung 9: Einstellungen (Einladungscode + Kopier-Icon)](projektunterlagen/abbildungen/09_einstellungen.png)

#### Backend
Die Backend-Struktur basiert auf Supabase (PostgreSQL) mit rollenbasierter Zugriffskontrolle.  
Wichtige Tabellen (Auszug, basierend auf der Nutzung im Code):
- **profiles**: Benutzerprofile (display_name, username, first_name, last_name, email)
- **organisations**: Vereine (id, name, logo_url)
- **organisation_members**: Mitglieder + Rollen (director/teacher/student)
- **groups**: Gruppen innerhalb eines Vereins (id, org_id, name, image_url)
- **group_members**: Gruppenmitgliedschaften
- **channels/messages**: Chatkanäle und Nachrichten
- **announcements**: Ankündigungen (inkl. optionalem event_date)
- **calendar_sync_queue**: Vereins-Termine als JSON-Payload (org scope)
- **personal_calendar_events**: persönliche Termine (start/end)
- **task_lists / tasks**: Aufgabenlisten und Aufgaben
- **assignments / assignment_submissions**: Aufgabenstellungen + Abgaben
- **exercises**: Übungsinhalte
- **activity_events/activity_seen**: Aktivitätsfeed

Speicher/Medien:
- **Storage Bucket `chat-media`**: Chat-Medien, Gruppenbilder, Vereinslogo
- **Storage Bucket `assignment-attachments`**: Aufgaben-Anhänge

Abbildungen (Platzhalter, Dateien unter `projektunterlagen/abbildungen/`):
![Abbildung 1: Systemarchitektur (Frontend <-> Supabase)](projektunterlagen/abbildungen/01_architektur.png)
![Abbildung 2: Datenbank-ERD (Supabase)](projektunterlagen/abbildungen/02_erd.png)
![Abbildung 10: Storage Buckets (optional)](projektunterlagen/abbildungen/10_storage.png)

## Abbildungsverzeichnis
Alle Abbildungen liegen unter `projektunterlagen/abbildungen/`.

Abbildung 1: Systemarchitektur (Frontend <-> Supabase) - Datei: `01_architektur.png`  
Abbildung 2: Datenbank-ERD (Supabase) - Datei: `02_erd.png`  
Abbildung 3: Login/Registrierung - Datei: `03_login.png`  
Abbildung 4: Startseite mit Vereinslogo - Datei: `04_startseite.png`  
Abbildung 5: Kalender (Wochenansicht + Termin-Modal) - Datei: `05_kalender.png`  
Abbildung 6: Chat (Gruppenliste + Chatansicht) - Datei: `06_chat.png`  
Abbildung 7: Aufgabenliste / Aufgaben-Detail - Datei: `07_aufgaben.png`  
Abbildung 8: Ankündigungen - Datei: `08_ankuendigungen.png`  
Abbildung 9: Einstellungen (Einladungscode, Kopierfunktion) - Datei: `09_einstellungen.png`  
Abbildung 10: Storage Buckets (optional) - Datei: `10_storage.png`

## Quellenverzeichnis
1. Expo Dokumentation - https://docs.expo.dev/ (Zugriff: [Datum])  
2. React Native Dokumentation - https://reactnative.dev/ (Zugriff: [Datum])  
3. Supabase Dokumentation - https://supabase.com/docs (Zugriff: [Datum])  
4. PostgreSQL Dokumentation - https://www.postgresql.org/docs/ (Zugriff: [Datum])  
5. Expo Router - https://docs.expo.dev/router/introduction/ (Zugriff: [Datum])  
6. Expo Image Picker - https://docs.expo.dev/versions/latest/sdk/imagepicker/ (Zugriff: [Datum])  
7. Expo Document Picker - https://docs.expo.dev/versions/latest/sdk/document-picker/ (Zugriff: [Datum])  
8. Expo Clipboard - https://docs.expo.dev/versions/latest/sdk/clipboard/ (Zugriff: [Datum])
