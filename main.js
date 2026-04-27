const { program } = require("commander");
const http = require("node:http");
const fs = require("fs/promises");
const express = require("express");
const multer = require("multer");
const path = require("path");
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

program
    .requiredOption("-h, --host <host>", "server address")
    .requiredOption("-p, --port <port>", "server's port", (port) => parseInt(port, 10))
    .requiredOption("-c, --cache <path>", "path to a directory which contains cached files");

program.parse();
const options = program.opts();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    
        app.post("/register", upload.single("photo"), async (request, response) => {
            const inventoryName = request.body.inventory_name;
            const description = request.body.description || "";
            const id = Date.now().toString();

            const newItem = {
                id: id,
                inventory_name: inventoryName,
                description: description,
                photo: request.file ? request.file.filename : null
            };

            try {
                await fs.writeFile(path.join(options.cache, `${id}.json`), JSON.stringify(newItem));
                response.status(201).json(newItem);
            } catch (error) {
                response.status(500).json({error: "Internal error"});
            }
        });

        app.get("/inventory", async (req, res) => {
            try {
                const files = await fs.readdir(options.cache);
                const jsonFiles = files.filter(file => file.endsWith('.json'));
                const inventoryList = [];

                for (const file of jsonFiles) {
                    const filePath = path.join(options.cache, file);
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    inventoryList.push(JSON.parse(fileContent));
                }
                
                res.status(200).json(inventoryList);
            } catch (error) {
                res.status(500).json({ error: "Internal error while reading the list." });
            }
        });

        app.get("/inventory/:id", async (req, res) => {
            const itemId = req.params.id; 
            const filePath = path.join(options.cache, `${itemId}.json`);

            try {
                await fs.access(filePath);
                
                const fileContent = await fs.readFile(filePath, "utf-8");
                const inventoryItem = JSON.parse(fileContent);
                
                res.status(200).json(inventoryItem);
            } catch (error) {
                res.status(404).json({ error: "Item with this id was not found." });
            }
        });

        app.put('/inventory/:id', async (req, res) => {
            const itemId = req.params.id;
            const filePath = path.join(options.cache, `${itemId}.json`);

            try {
                const fileContent = await fs.readFile(filePath, "utf-8");
                const inventoryItem = JSON.parse(fileContent);

                if (req.body.inventory_name) {
                    inventoryItem.inventory_name = req.body.inventory_name;
                }
                
                if (req.body.description !== undefined) { 
                    inventoryItem.description = req.body.description;
                }

                await fs.writeFile(filePath, JSON.stringify(inventoryItem));
                
                res.status(200).json(inventoryItem);
            } catch (error) {
                console.error(error.message);
                res.status(404).json({ error: "Item with this id was not found." });
            }
        });

        app.delete('/inventory/:id', async (req, res) => {
            const itemId = req.params.id;
            const jsonPath = path.join(options.cache, `${itemId}.json`);

            try {
                const fileContent = await fs.readFile(jsonPath, "utf-8");
                const inventoryItem = JSON.parse(fileContent);

                await fs.unlink(jsonPath);

                if (inventoryItem.photo) {
                    const photoPath = path.join(options.cache, inventoryItem.photo);
                    await fs.unlink(photoPath).catch(() => {}); 
                }

                res.status(200).json({ message: "Item was successfully deleted." });
            } catch (error) {
                res.status(404).json({ error: "Item with this id was not found." });
            }
        });

        app.get('/inventory/:id/photo', async (req, res) => {
            const itemId = req.params.id;
            const jsonPath = path.join(options.cache, `${itemId}.json`);

            try {
                const fileContent = await fs.readFile(jsonPath, 'utf-8');
                const inventoryItem = JSON.parse(fileContent);

                if (!inventoryItem.photo) {
                    return res.status(404).json({ error: "Photo for this item was not found." });
                }

                const photoPath = path.join(options.cache, inventoryItem.photo);
                await fs.access(photoPath);

                res.setHeader('Content-Type', 'image/jpeg'); 
                res.sendFile(path.resolve(photoPath)); 

            } catch (error) {
                res.status(404).json({ error: "Item or it's photo was not found." });
            }
        });

        app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
            const itemId = req.params.id;
            const jsonPath = path.join(options.cache, `${itemId}.json`);

            if (!req.file) {
                return res.status(400).json({ error: "Photo file is required." });
            }

            try {
                const fileContent = await fs.readFile(jsonPath, 'utf-8');
                const inventoryItem = JSON.parse(fileContent);

                if (inventoryItem.photo) {
                    const oldPhotoPath = path.join(options.cache, inventoryItem.photo);
                    await fs.unlink(oldPhotoPath).catch(() => {});
                }

                inventoryItem.photo = req.file.filename;
                await fs.writeFile(jsonPath, JSON.stringify(inventoryItem));

                res.status(200).json(inventoryItem);
            } catch (error) {
                const uploadedPhotoPath = path.join(options.cache, req.file.filename);
                await fs.unlink(uploadedPhotoPath).catch(() => {});

                res.status(404).json({ error: "Item with this id was not found." });
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

            const jsonPath = path.join(options.cache, `${id}.json`);

            try {
                const fileContent = await fs.readFile(jsonPath, 'utf-8');
                const inventoryItem = JSON.parse(fileContent);

                if (has_photo === 'on' || has_photo === true) {
                    if (inventoryItem.photo) {
                        inventoryItem.description += ` (Photo link: /inventory/${id}/photo)`;
                    }
                }

                res.status(200).json(inventoryItem);
            } catch (error) {
                res.status(404).json({ error: "Item was not found." });
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