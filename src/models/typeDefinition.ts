import { SchemaObjectContract } from "../contracts/schema";


export abstract class TypeDefinitionPropertyType {
    public displayAs: string;

    constructor(displayAs: string) {
        this.displayAs = displayAs;
    }
}


export class TypeDefinitionPropertyTypePrimitive extends TypeDefinitionPropertyType {
    constructor(public readonly name: string) {
        super("primitive");
    }
}

export class TypeDefinitionPropertyTypeReference extends TypeDefinitionPropertyType {
    constructor(public readonly name: string) {
        super("reference");
    }
}

export class TypeDefinitionPropertyTypeArrayOfPrimitive extends TypeDefinitionPropertyType {
    constructor(public readonly name: string) {
        super("arrayOfPrimitive");
    }
}

export class TypeDefinitionPropertyTypeArrayOfReference extends TypeDefinitionPropertyType {
    constructor(public name: string) {
        super("arrayOfReference");
    }
}

export class TypeDefinitionPropertyTypeCombination extends TypeDefinitionPropertyType {
    constructor(
        public readonly combinationType: string,
        public readonly combination: TypeDefinitionPropertyType[]
    ) {
        super("combination");
    }
}

export abstract class TypeDefinitionProperty {
    /**
     * Type definition name.
     */
    public name: string;

    /**
     * Type definition description.
     */
    public description: string;

    /**
     * e.g. "string", "boolean", "object", etc.
     */
    public type?: TypeDefinitionPropertyType;

    /**
     * e.g. "primitive", "object", "array".
     */
    public kind?: string;

    /**
     * Definition example.
     */
    public example?: string;

    /**
     * Definition example format, mostly used for syntax highlight, e.g. "json", "xml", "plain".
     */
    public exampleFormat?: string = "json";

    /**
     * Defines if this property is required.
     */
    public required?: boolean;

    /**
     * Hints if the this property is array of "type".
     */
    public isArray: boolean;

    /**
     * List of allowed values.
     */
    public enum: any[];


    constructor(name: string, contract: SchemaObjectContract, isRequired: boolean, isArray: boolean) {
        this.name = contract.title || name;
        this.description = contract.description;
        this.type = new TypeDefinitionPropertyTypePrimitive(contract.format || contract.type || "object");
        this.isArray = isArray;

        if (contract.example) {
            if (typeof contract.example === "object") {
                this.example = JSON.stringify(contract.example, null, 4);
            }
            else {
                this.example = contract.example;
            }
        }

        this.required = isRequired;
    }
}

export class TypeDefinitionPrimitiveProperty extends TypeDefinitionProperty {
    constructor(name: string, contract: SchemaObjectContract, isRequired: boolean, isArray: boolean = false) {
        super(name, contract, isRequired, isArray);

        this.kind = "primitive";
    }
}

export class TypeDefinitionEnumerationProperty extends TypeDefinitionProperty {
    constructor(name: string, contract: SchemaObjectContract, isRequired: boolean, isArray: boolean = false) {
        super(name, contract, isRequired, isArray);

        this.kind = "enum";
    }
}

export class TypeDefinitionCombinationProperty extends TypeDefinitionProperty {
    constructor(name: string, contract: SchemaObjectContract, isRequired: boolean) {
        super(name, contract, isRequired, false);

        let combinationType;
        let combinationArray;

        if (contract.allOf) {
            combinationType = "All of";
            combinationArray = contract.allOf;
        }

        if (contract.anyOf) {
            combinationType = "Any of";
            combinationArray = contract.anyOf;
        }

        if (contract.oneOf) {
            combinationType = "One of";
            combinationArray = contract.oneOf;
        }

        if (contract.not) {
            combinationType = "Not";
            combinationArray = contract.not;
        }

        const combination = combinationArray.map(item => {
            if (item.$ref) {
                return new TypeDefinitionPropertyTypeReference(getTypeNameFromRef(item.$ref));
            }
            return new TypeDefinitionPropertyTypePrimitive(item.type || "object");
        });

        this.type = new TypeDefinitionPropertyTypeCombination(combinationType, combination);
        this.kind = "combination";
    }
}

export class TypeDefinitionObjectProperty extends TypeDefinitionProperty {
    /**
     * Object properties.
     */
    public properties?: TypeDefinitionProperty[];

    constructor(name: string, contract: SchemaObjectContract, isRequired: boolean, isArray: boolean = false, nested: boolean = false) {
        super(name, contract, isRequired, isArray);

        this.kind = "object";

        if (contract.$ref) { // reference
            this.type = new TypeDefinitionPropertyTypeReference(getTypeNameFromRef(contract.$ref));
            return;
        }

        if (contract.items) { // indexer
            let type = new TypeDefinitionPropertyTypePrimitive("object");

            if (contract.items.type) {
                type = new TypeDefinitionPropertyTypePrimitive(contract.items.type);
            }

            if (contract.items.$ref) {
                type = new TypeDefinitionPropertyTypeReference(getTypeNameFromRef(contract.items.$ref));
            }

            this.properties = [new TypeDefinitionIndexerProperty(type)];
            this.kind = "indexer";
            return;
        }

        if (contract.enum) { // enumeration
            this.enum = contract.enum;
            this.kind = "enum";
        }

        if (contract.properties) { // complex type
            const props = [];

            Object
                .keys(contract.properties)
                .forEach(propertyName => {
                    try {
                        const propertySchemaObject = contract.properties[propertyName];

                        if (!propertySchemaObject) {
                            return;
                        }

                        const isRequired = contract.required?.includes(propertyName) || false;

                        if (propertySchemaObject.$ref) {
                            propertySchemaObject.type = "object";
                        }

                        if (propertySchemaObject.items) {
                            propertySchemaObject.type = "array";
                        }

                        if (propertySchemaObject.allOf ||
                            propertySchemaObject.anyOf ||
                            propertySchemaObject.oneOf ||
                            propertySchemaObject.not
                        ) {
                            propertySchemaObject.type = "combination";
                        }

                        switch (propertySchemaObject.type) {
                            case "integer":
                            case "number":
                            case "string":
                            case "boolean":
                                if (propertySchemaObject.enum) {
                                    props.push(new TypeDefinitionEnumerationProperty(propertyName, propertySchemaObject, isRequired));
                                }
                                else {
                                    props.push(new TypeDefinitionPrimitiveProperty(propertyName, propertySchemaObject, isRequired));
                                }
                              
                                break;

                            case "object":
                                const objectProperty = new TypeDefinitionObjectProperty(propertyName, propertySchemaObject, isRequired, true, true);

                                if (!nested) {
                                    const flattenObjects = this.flattenNestedObjects(objectProperty, propertyName);
                                    props.push(...flattenObjects);
                                }
                                else {
                                    props.push(objectProperty);
                                }

                                break;

                            case "array":
                                const arrayProperty = new TypeDefinitionPrimitiveProperty(propertyName, propertySchemaObject, isRequired, true);

                                if (!propertySchemaObject.items) {
                                    return arrayProperty;
                                }

                                if (propertySchemaObject.items.$ref) {
                                    arrayProperty.type = new TypeDefinitionPropertyTypeArrayOfReference(getTypeNameFromRef(propertySchemaObject.items.$ref));
                                }
                                else if (propertySchemaObject.items.type) {
                                    arrayProperty.type = new TypeDefinitionPropertyTypeArrayOfPrimitive(propertySchemaObject.items.type);
                                }
                                else {
                                    const objectProperty = new TypeDefinitionObjectProperty(propertyName + "[]", propertySchemaObject.items, isRequired, true, true);
                                    props.push(objectProperty);
                                }

                                props.push(arrayProperty);
                                break;

                            case "combination":
                                props.push(new TypeDefinitionCombinationProperty(propertyName, propertySchemaObject, isRequired));
                                break;

                            default:
                                console.warn(`Unknown type of schema definition: ${propertySchemaObject.type}`);
                        }
                    }
                    catch (error) {
                        console.warn(`Unable to process object property ${propertyName}. Error: ${error}`);
                    }
                });

            this.properties = props;
        }
    }

    private flattenNestedObjects(nested: TypeDefinitionProperty, prefix: string): TypeDefinitionProperty[] {
        const result = [];

        if (!nested["properties"]) {
            return result;
        }

        nested["properties"].forEach(property => {
            if (property instanceof TypeDefinitionObjectProperty) {
                result.push(...this.flattenNestedObjects(<TypeDefinitionObjectProperty>property, prefix + "." + property.name));
            }
            else {
                property.name = prefix + "." + property.name;
                result.push(property);
            }
        });

        return result;
    }
}

function getTypeNameFromRef($ref: string): string {
    return $ref && $ref.split("/").pop();
}

export class TypeDefinitionIndexerProperty extends TypeDefinitionObjectProperty {
    constructor(type: TypeDefinitionPropertyType) {
        super("[]", {}, true);

        this.kind = "indexer";
        this.type = type;
    }
}

export class TypeDefinition extends TypeDefinitionObjectProperty {
    constructor(name: string, contract: SchemaObjectContract) {
        super(name, contract, true);

        this.name = name;
    }

    public toString(): string {
        return this.name;
    }
}
