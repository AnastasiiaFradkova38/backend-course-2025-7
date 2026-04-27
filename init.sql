CREATE DATABASE InventoryDB;
GO

USE InventoryDB;
GO

CREATE TABLE Inventory (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    InventoryName NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    PhotoPath NVARCHAR(500) NULL
);
GO

INSERT INTO Inventory (InventoryName, Description, PhotoPath) 
VALUES 
    ('Laptop Dell XPS 15', 'Laptop for work', 'laptop.jpg'),
    ('Fridge', 'The best fridge', 'fridge.jpg');
GO
