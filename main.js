const { program } = require("commander");
const http = require("node:http");
const fs = require("fs/promises");
const express = require("express");
const multer = require("multer");
const path = require("path");
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const sql = require('mssql');
require('dotenv').config();

program
    .requiredOption("-h, --host <host>", "server address")
    .requiredOption("-p, --port <port>", "server's port", (port) => parseInt(port, 10))
    .requiredOption("-c, --cache <path>", "path to a directory which contains cached files");

program.parse();
const options = program.opts();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dbConfig = {
    user: 'sa',
    password: process.env.DB_PASSWORD,
    server: 'db',
    database: 'InventoryDB',
    port: 1433,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, options.cache); 
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage });

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

async function main() {
    try {
        if (Number.isNaN(options.port)) {
            throw new Error("Invalid port specified.");
        }

        await fs.mkdir(options.cache, {recursive: true});

        const pool = await sql.connect(dbConfig);
        console.log("Connected to SQL Server!");
    
        app.post("/register", upload.single("photo"), async (request, response) => {
            const inventoryName = request.body.inventory_name;
            const description = request.body.description || "";
            const photoPath = request.file ? request.file.filename : null;

            if (!inventoryName) {
                return response.status(400).json({ error: "inventory_name is required" });
            }

            try {
                const result = await pool.request()
                    .input('name', sql.NVarChar, inventoryName)
                    .input('desc', sql.NVarChar, description)
                    .input('photo', sql.NVarChar, photoPath)
                    .query(`
                        INSERT INTO Inventory (InventoryName, Description, PhotoPath) 
                        OUTPUT INSERTED.ID as id, INSERTED.InventoryName as inventory_name, INSERTED.Description as description, INSERTED.PhotoPath as photo
                        VALUES (@name, @desc, @photo)
                    `);
                
                response.status(201).json(result.recordset[0]);
            } catch (error) {
                console.error(error);
                response.status(500).json({error: "Internal error during database insert."});
            }
        });

        app.get("/inventory", async (req, res) => {
            try {
                const result = await pool.request().query(`
                    SELECT ID as id, InventoryName as inventory_name, Description as description, PhotoPath as photo 
                    FROM Inventory
                `);
                res.status(200).json(result.recordset);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Internal error while reading the list." });
            }
        });

        app.get("/inventory/:id", async (req, res) => {
            try {
                const result = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query(`
                        SELECT ID as id, InventoryName as inventory_name, Description as description, PhotoPath as photo 
                        FROM Inventory WHERE ID = @id
                    `);

                if (result.recordset.length === 0) {
                    return res.status(404).json({ error: "Item with this id was not found." });
                }
                
                res.status(200).json(result.recordset[0]);
            } catch (error) {
                res.status(500).json({ error: "Internal error" });
            }
        });

        app.put('/inventory/:id', async (req, res) => {
            const { inventory_name, description } = req.body;

            try {
                const checkResult = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query('SELECT ID FROM Inventory WHERE ID = @id');

                if (checkResult.recordset.length === 0) {
                    return res.status(404).json({ error: "Item with this id was not found." });
                }

                const updateResult = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .input('name', sql.NVarChar, inventory_name)
                    .input('desc', sql.NVarChar, description)
                    .query(`
                        UPDATE Inventory 
                        SET InventoryName = COALESCE(@name, InventoryName), 
                            Description = COALESCE(@desc, Description)
                        OUTPUT INSERTED.ID as id, INSERTED.InventoryName as inventory_name, INSERTED.Description as description, INSERTED.PhotoPath as photo
                        WHERE ID = @id
                    `);
                
                res.status(200).json(updateResult.recordset[0]);
            } catch (error) {
                console.error(error.message);
                res.status(500).json({ error: "Internal server error." });
            }
        });

        app.delete('/inventory/:id', async (req, res) => {
            try {
                const result = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query('SELECT PhotoPath FROM Inventory WHERE ID = @id');

                if (result.recordset.length === 0) {
                    return res.status(404).json({ error: "Item with this id was not found." });
                }

                const photoPath = result.recordset[0].PhotoPath;

                await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query('DELETE FROM Inventory WHERE ID = @id');

                if (photoPath) {
                    const fullPhotoPath = path.join(options.cache, photoPath);
                    await fs.unlink(fullPhotoPath).catch(() => {}); 
                }

                res.status(200).json({ message: "Item was successfully deleted." });
            } catch (error) {
                res.status(500).json({ error: "Internal server error." });
            }
        });

        app.get('/inventory/:id/photo', async (req, res) => {
            try {
                const result = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query('SELECT PhotoPath FROM Inventory WHERE ID = @id');

                if (result.recordset.length === 0 || !result.recordset[0].PhotoPath) {
                    return res.status(404).json({ error: "Item or its photo was not found." });
                }

                const fullPhotoPath = path.join(options.cache, result.recordset[0].PhotoPath);
                await fs.access(fullPhotoPath);

                res.setHeader('Content-Type', 'image/jpeg'); 
                res.sendFile(path.resolve(fullPhotoPath)); 

            } catch (error) {
                res.status(404).json({ error: "Photo file not found on server." });
            }
        });

        app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ error: "Photo file is required." });
            }

            try {
                const result = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .query('SELECT PhotoPath FROM Inventory WHERE ID = @id');

                if (result.recordset.length === 0) {
                    const uploadedPhotoPath = path.join(options.cache, req.file.filename);
                    await fs.unlink(uploadedPhotoPath).catch(() => {});
                    return res.status(404).json({ error: "Item with this id was not found." });
                }

                const oldPhotoPath = result.recordset[0].PhotoPath;

                const updateResult = await pool.request()
                    .input('id', sql.Int, parseInt(req.params.id))
                    .input('photo', sql.NVarChar, req.file.filename)
                    .query(`
                        UPDATE Inventory SET PhotoPath = @photo 
                        OUTPUT INSERTED.ID as id, INSERTED.InventoryName as inventory_name, INSERTED.Description as description, INSERTED.PhotoPath as photo
                        WHERE ID = @id
                    `);

                if (oldPhotoPath) {
                    const oldFullPhotoPath = path.join(options.cache, oldPhotoPath);
                    await fs.unlink(oldFullPhotoPath).catch(() => {});
                }

                res.status(200).json(updateResult.recordset[0]);
            } catch (error) {
                res.status(500).json({ error: "Internal server error." });
            }
        });

        app.get('/RegisterForm.html', (req, res) => {
            res.sendFile(path.join(__dirname, 'RegisterForm.html'));
        });

        app.get('/SearchForm.html', (req, res) => {
            res.sendFile(path.join(__dirname, 'SearchForm.html'));
        });

        app.post('/search', async (req, res) => {
            const { id, has_photo } = req.body;

            if (!id) {
                return res.status(400).json({ error: "Id field is required." });
            }

            try {
                const result = await pool.request()
                    .input('id', sql.Int, parseInt(id))
                    .query(`
                        SELECT ID as id, InventoryName as inventory_name, Description as description, PhotoPath as photo 
                        FROM Inventory WHERE ID = @id
                    `);

                if (result.recordset.length === 0) {
                    return res.status(404).json({ error: "Item was not found." });
                }

                const inventoryItem = result.recordset[0];

                if ((has_photo === 'on' || has_photo === true) && inventoryItem.photo) {
                    inventoryItem.description += ` (Photo link: /inventory/${inventoryItem.id}/photo)`;
                }

                res.status(200).json(inventoryItem);
            } catch (error) {
                res.status(500).json({ error: "Internal server error." });
            }
        });

        app.use((req, res) => {
            res.status(405).json({ error: "Method not allowed." });
        });

        const server = http.createServer(app);
        
        server.listen(options.port, options.host, () => {
            console.log(`Listening on ${options.host}:${options.port}.`);
        });

        process.on("SIGINT", () => {
            server.close(() => {
                console.log("Server was successfully closed.");
                process.exit(0);
            });
        })
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

main();