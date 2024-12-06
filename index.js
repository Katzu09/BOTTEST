const mysql = require('mysql2/promise');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Groq } = require("groq-sdk");
require('dotenv').config();

// Fallback storage jika MySQL gagal
const memoryStorage = new Map();
let useMemoryStorage = false;

// Konfigurasi MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'botradja'
};

// Inisialisasi koneksi MySQL
let connection;

async function initializeDatabase() {
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Tabel chat history
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                group_id VARCHAR(255),
                role VARCHAR(50),
                content TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabel anggota keluarga
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS family_members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nama VARCHAR(100),
                tanggal_lahir DATE,
                hubungan VARCHAR(50),
                orang_tua VARCHAR(100),
                info_tambahan TEXT
            )
        `);

        // Drop tabel jika sudah ada untuk menghindari duplikasi
        await connection.execute(`DROP TABLE IF EXISTS family_members`);

        // Buat ulang tabel dengan struktur yang benar
        await connection.execute(`
            CREATE TABLE family_members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nama VARCHAR(100),
                tanggal_lahir DATE,
                hubungan VARCHAR(50),
                orang_tua VARCHAR(100),
                info_tambahan TEXT
            )
        `);

        // Masukkan data keluarga
        await connection.execute(`
            INSERT INTO family_members (nama, tanggal_lahir, hubungan, orang_tua, info_tambahan) 
            VALUES 
            ('Nenek Lince', '1945-01-01', 'nenek', NULL, 'Istri dari Kakek Arjon Uteng'),
            ('Kakek Arjon Uteng', '1943-05-15', 'kakek', NULL, 'Suami dari Nenek Lince'),
            ('Lasmiana', '1970-03-20', 'anak', 'Lince dan Arjon Uteng', 'Anak dari Nenek Lince dan Kakek Arjon'),
            ('Ma Ani', '1972-07-10', 'anak', 'Lince dan Arjon Uteng', 'Anak dari Nenek Lince dan Kakek Arjon'),
            ('Ma Ice', '1975-08-15', 'anak', 'Lince dan Arjon Uteng', 'Anak dari Nenek Lince dan Kakek Arjon'),
            ('Ma Ati', '1977-11-20', 'anak', 'Lince dan Arjon Uteng', 'Anak dari Nenek Lince dan Kakek Arjon'),
            ('Marsudik', '1980-04-25', 'anak', 'Lince dan Arjon Uteng', 'Anak dari Nenek Lince dan Kakek Arjon'),
            ('Allan', '1995-12-25', 'cucu', 'Lasmiana dan Ayahh', 'Anak dari Lasmiana'),
            ('Amar', '1998-06-15', 'cucu', 'Ma Ani', 'Anak dari Ma Ani'),
            ('Affa', '2000-03-10', 'cucu', 'Ma Ice dan Sultan Ali', 'Anak dari Ma Ice dan Sultan Ali'),
            ('Adit', '2002-09-05', 'cucu', 'Ma Ani', 'Anak dari Ma Ani'),
            ('Arfan', '2003-07-20', 'cucu', 'Ma Ice dan Sultan Ali', 'Anak dari Ma Ice dan Sultan Ali'),
            ('Risky', '2004-11-30', 'cucu', 'Ma Ati', 'Anak dari Ma Ati'),
            ('Radja', '2005-08-12', 'cucu', 'Marsudik', 'Anak dari Marsudik'),
            ('Putri', '2006-04-18', 'cucu', 'Ma Ati', 'Anak dari Ma Ati'),
            ('Nona Ali', '2007-01-25', 'cucu', 'Ma Ice dan Sultan Ali', 'Anak dari Ma Ice dan Sultan Ali'),
            ('Fanny', '2008-10-15', 'cucu', 'Lasmiana dan Ayahh', 'Anak dari Lasmiana'),
            ('Sultan Ali', '1974-02-28', 'menantu', 'Suami Ma Ice', 'Suami dari Ma Ice'),
            ('Intan', '2009-05-22', 'cucu', 'Marsudik', 'Anak dari Marsudik'),
            ('Tiqah', '2010-12-08', 'cucu', 'Lasmiana dan Ayahh', 'Anak dari Lasmiana'),
            ('Jihan', '2012-03-17', 'cucu', 'Marsudik', 'Anak dari Marsudik'),
            ('Inaya', '2014-09-30', 'cucu', 'Marsudik', 'Anak dari Marsudik')
        `);
        
        useMemoryStorage = false;
        console.log('Database berhasil terhubung!');
    } catch (error) {
        useMemoryStorage = true;
        console.error('Error koneksi database, menggunakan memory storage:', error);
    }
}

// Fungsi untuk mengambil riwayat chat
async function getChatHistory(groupId) {
    if (useMemoryStorage) {
        return memoryStorage.get(groupId) || [];
    }

    try {
        const [rows] = await connection.execute(
            'SELECT role, content FROM chat_history WHERE group_id = ? ORDER BY timestamp ASC LIMIT 10',
            [groupId]
        );
        return rows.map(row => ({
            role: row.role,
            content: row.content
        }));
    } catch (error) {
        console.error('Error mengambil riwayat dari database:', error);
        return memoryStorage.get(groupId) || [];
    }
}

// Fungsi untuk menyimpan pesan
async function saveMessage(groupId, role, content) {
    if (useMemoryStorage) {
        if (!memoryStorage.has(groupId)) {
            memoryStorage.set(groupId, []);
        }
        const history = memoryStorage.get(groupId);
        history.push({ role, content });
        // Batasi riwayat di memory
        if (history.length > 10) {
            history.splice(0, history.length - 10);
        }
        return;
    }

    try {
        await connection.execute(
            'INSERT INTO chat_history (group_id, role, content) VALUES (?, ?, ?)',
            [groupId, role, content]
        );
    } catch (error) {
        console.error('Error menyimpan pesan ke database:', error);
        // Fallback ke memory storage
        if (!memoryStorage.has(groupId)) {
            memoryStorage.set(groupId, []);
        }
        const history = memoryStorage.get(groupId);
        history.push({ role, content });
    }
}

// Fungsi untuk menghapus riwayat chat
async function clearChatHistory(groupId) {
    if (useMemoryStorage) {
        memoryStorage.delete(groupId);
        return;
    }

    try {
        await connection.execute(
            'DELETE FROM chat_history WHERE group_id = ?',
            [groupId]
        );
    } catch (error) {
        console.error('Error menghapus riwayat dari database:', error);
        memoryStorage.delete(groupId);
    }
}

// Fungsi untuk mendapatkan informasi keluarga berdasarkan generasi
async function getFamilyByGeneration() {
    try {
        // Ambil generasi pertama (kakek nenek)
        const [g1] = await connection.execute(
            'SELECT nama, tanggal_lahir, hubungan, info_tambahan FROM family_members WHERE hubungan IN ("nenek", "kakek") ORDER BY tanggal_lahir ASC'
        );

        // Ambil generasi kedua (anak-anak)
        const [g2] = await connection.execute(
            'SELECT nama, tanggal_lahir, hubungan, orang_tua, info_tambahan FROM family_members WHERE hubungan = "anak" ORDER BY tanggal_lahir ASC'
        );

        // Ambil generasi ketiga (cucu-cucu)
        const [g3] = await connection.execute(
            'SELECT nama, tanggal_lahir, hubungan, orang_tua, info_tambahan FROM family_members WHERE hubungan = "cucu" ORDER BY tanggal_lahir ASC'
        );

        return { g1, g2, g3 };
    } catch (error) {
        console.error('Error mengambil data keluarga:', error);
        return null;
    }
}

// Inisialisasi database saat startup
initializeDatabase();

// Inisialisasi WhatsApp client dengan LocalAuth
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox']
    },
    authStrategy: new LocalAuth()
});

// Inisialisasi Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// Generate QR code untuk WhatsApp Web
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR Code telah digenerate, silakan scan menggunakan WhatsApp Anda');
});

// Handler ketika client sudah siap
client.on('ready', () => {
    console.log('Client sudah siap!');
});

// Handler untuk pesan masuk
client.on('message', async (message) => {
    try {
        const allowedGroupId = '120363375499366368@g.us';
        if (message.from !== allowedGroupId) {
            return;
        }

        if (message.body === '.help') {
            const helpMessage = `*🤖 Radja Assistant AI - Panduan Penggunaan*

*Daftar Perintah:*
• .help - Menampilkan panduan ini
• .reset - Menghapus riwayat percakapan
• .getid - Mendapatkan ID grup

*Cara Menggunakan Bot:*
1. Gunakan titik (.) di awal pesan untuk berbicara dengan bot
   Contoh: .siapa kamu?

2. Bot akan mengingat konteks percakapan
   Gunakan .reset untuk memulai percakapan baru

*Dibuat oleh:* Radja Uteng`;

            await message.reply(helpMessage);
            return;
        }

        if (message.body === '.reset') {
            await clearChatHistory(message.from);
            await message.reply('Percakapan telah direset.');
            return;
        }

        if (message.body === '.getid') {
            const chat = await message.getChat();
            await message.reply(`ID Grup: ${chat.id._serialized}\nNama Grup: ${chat.name}`);
            return;
        }

        if (!message.body.startsWith('.')) {
            return;
        }

        const userMessage = message.body.slice(1).trim();
        let messageHistory = await getChatHistory(message.from);
        
        // Tambahkan system prompt dengan data dari database
        if (messageHistory.length === 0) {
            const familyData = await getFamilyByGeneration();
            
            if (familyData) {
                const g1Info = familyData.g1.map(member => 
                    `   - ${member.nama} (lahir ${new Date(member.tanggal_lahir).toISOString().split('T')[0]}) - ${member.info_tambahan}`
                ).join('\n');

                const g2Info = familyData.g2.map(member =>
                    `   - ${member.nama} (lahir ${new Date(member.tanggal_lahir).toISOString().split('T')[0]}) - ${member.info_tambahan}`
                ).join('\n');

                const g3Info = familyData.g3.map(member =>
                    `   - ${member.nama} (lahir ${new Date(member.tanggal_lahir).toISOString().split('T')[0]}) - anak dari ${member.orang_tua}`
                ).join('\n');

                messageHistory.push({
                    role: "system",
                    content: `Anda adalah Radja Assistant AI, asisten keluarga berbahasa Indonesia yang diciptakan oleh Radja Uteng khusus untuk grup WhatsApp keluarga besar Nenek Lince dan Kakek Arjon Uteng.

PENTING: 
- SELALU GUNAKAN BAHASA INDONESIA DALAM SETIAP RESPONS!
- Anda adalah bagian dari grup WhatsApp keluarga
- Berikan respons yang sopan dan akrab seperti berbicara dengan keluarga sendiri

Informasi Keluarga Besar:
1. Generasi Pertama (Kepala Keluarga):
${g1Info}

2. Anak-anak (Generasi Kedua):
${g2Info}

3. Cucu-cucu (Generasi Ketiga) berdasarkan usia:
${g3Info}

PANDUAN MENJAWAB:
1. Gunakan bahasa Indonesia yang sopan dan akrab
2. Jika ditanya tentang cucu:
   - ${familyData.g3[0].nama} adalah cucu TERTUA (lahir ${new Date(familyData.g3[0].tanggal_lahir).toISOString().split('T')[0]})
   - ${familyData.g3[familyData.g3.length-1].nama} adalah cucu TERMUDA (lahir ${new Date(familyData.g3[familyData.g3.length-1].tanggal_lahir).toISOString().split('T')[0]})
3. Jika ditanya tentang hubungan keluarga:
   - Jelaskan seperti berbicara dengan anggota keluarga
   - Contoh: "Kak Allan adalah anak dari Tante Lasmiana"
4. Jika ditanya tentang umur:
   - Hitung dari tahun lahir
   - Gunakan panggilan yang sesuai (Kakak/Adik)

INGAT: 
- Anda adalah asisten keluarga di grup WhatsApp
- Gunakan bahasa Indonesia yang sopan dan akrab
- Gunakan panggilan yang sesuai (Nenek, Kakek, Tante, Om, Kakak, Adik)
- Tunjukkan kehangatan keluarga dalam setiap respons`
                });
            }
        }

        // Tambahkan informasi keluarga jika ada kata kunci relevan
        if (userMessage.toLowerCase().includes('cucu') || 
            userMessage.toLowerCase().includes('anak') || 
            userMessage.toLowerCase().includes('umur') ||
            userMessage.toLowerCase().includes('lahir') ||
            userMessage.toLowerCase().includes('siapa') ||
            userMessage.toLowerCase().includes('tua') ||
            userMessage.toLowerCase().includes('muda') ||
            userMessage.toLowerCase().includes('keluarga') ||
            userMessage.toLowerCase().includes('nenek') ||
            userMessage.toLowerCase().includes('kakek')) {
            
            const familyData = await getFamilyByGeneration();
            if (familyData) {
                messageHistory.push({
                    role: "system",
                    content: `*🏠 SELAMAT DATANG DI GRUP WHATSAPP UTENG FAMILY!* 👨‍👩‍👧‍👦

_Saya adalah Radja Assistant AI, asisten keluarga khusus untuk grup WhatsApp Uteng Family - Keluarga Besar Nenek Lince & Kakek Arjon Uteng._

*INFORMASI LENGKAP UTENG FAMILY:*

*👴👵 GENERASI PERTAMA (Pendiri Uteng Family):*
• \`Kakek Arjon Uteng\` - Kepala Keluarga Besar Uteng Family
• \`Nenek Lince\` - Istri Kakek Arjon Uteng

*👨👩 GENERASI KEDUA (Anak-anak Uteng):*
1. \`Tante Lasmiana Uteng\` (Anak Pertama)
   - Memiliki 3 anak: _Kak Allan, Fanny, dan Tiqah_
2. \`Tante Ma Ani Uteng\` (Anak Kedua)
   - Memiliki 2 anak: _Kak Amar dan Adit_
3. \`Tante Ma Ice Uteng\` (Anak Ketiga)
   - Menikah dengan \`Om Sultan Ali\`
   - Memiliki 3 anak: _Affa, Arfan, dan Nona Ali_
4. \`Tante Ma Ati Uteng\` (Anak Keempat)
   - Memiliki 2 anak: _Risky dan Putri_
5. \`Om Marsudik Uteng\` (Anak Kelima)
   - Memiliki 4 anak: _Radja, Intan, Jihan, dan Inaya_

*👶 GENERASI KETIGA (Cucu-cucu Uteng):*
• Cucu Tertua: \`Kak Allan\` (anak Tante Lasmiana)
• Cucu Termuda: \`Inaya\` (anak Om Marsudik)

*Urutan Cucu Uteng dari yang Tertua:*
1. _Kak Allan_ (anak Tante Lasmiana)
2. _Kak Amar_ (anak Tante Ma Ani)
3. _Affa_ (anak Tante Ma Ice)
4. _Adit_ (anak Tante Ma Ani)
5. _Arfan_ (anak Tante Ma Ice)
6. _Risky_ (anak Tante Ma Ati)
7. _Radja_ (anak Om Marsudik)
8. _Putri_ (anak Tante Ma Ati)
9. _Nona Ali_ (anak Tante Ma Ice)
10. _Fanny_ (anak Tante Lasmiana)
11. _Intan_ (anak Om Marsudik)
12. _Tiqah_ (anak Tante Lasmiana)
13. _Jihan_ (anak Om Marsudik)
14. _Inaya_ (anak Om Marsudik)

*PANDUAN MENJAWAB UNTUK UTENG FAMILY:*
1. Gunakan panggilan yang tepat dalam keluarga:
   • \`Kakek/Nenek Uteng\` untuk generasi pertama
   • \`Tante/Om\` untuk generasi kedua
   • \`Kakak/Adik\` untuk generasi ketiga
2. _Jelaskan hubungan keluarga dengan detail_
3. _Sebutkan urutan usia jika relevan_
4. _Tunjukkan kehangatan keluarga Uteng dalam setiap jawaban_

*INGAT:* 
- _Kita adalah satu keluarga besar Uteng Family_
- _Selalu jawab dengan bahasa Indonesia yang sopan dan akrab_
- _Tunjukkan rasa bangga sebagai bagian dari Uteng Family_
- _Utamakan nilai-nilai kekeluargaan dalam setiap respons_

Format Teks WhatsApp:
• *teks tebal* = diawali dan diakhiri dengan *
• _teks miring_ = diawali dan diakhiri dengan _
• \`teks monospace\` = diawali dan diakhiri dengan \`
• ~teks coret~ = diawali dan diakhiri dengan ~`
                });
            }
        }

        // Tambahkan pesan user
        messageHistory.push({
            role: "user",
            content: userMessage
        });

        // Tambahkan pengingat bahasa Indonesia
        messageHistory.push({
            role: "system",
            content: "INGAT: Berikan respons dalam BAHASA INDONESIA yang sopan dan informatif!"
        });

        // Simpan pesan user ke database
        await saveMessage(message.from, "user", userMessage);

        const completion = await groq.chat.completions.create({
            messages: messageHistory,
            model: "llama3-70b-8192",
            temperature: 0.7,
            max_tokens: 1024,
            stream: false
        });

        const response = completion.choices[0].message.content;

        // Simpan respons AI ke database
        await saveMessage(message.from, "assistant", response);
        
        await message.reply(response);
        console.log(`Respons terkirim: ${response}`);

    } catch (error) {
        console.error('Error:', error);
        await message.reply('Maaf, terjadi kesalahan dalam memproses pesan Anda.');
    }
});

// Inisialisasi client WhatsApp
client.initialize(); 