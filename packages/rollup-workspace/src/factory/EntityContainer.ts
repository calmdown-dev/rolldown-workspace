import type { AnyEntity, NameOf } from "./Entity";

export interface EntityContainer<TEntity extends AnyEntity, TEntities extends EntityMap<TEntity> = EntityMap<TEntity>> {
	readonly entityKind: string;
	readonly entityMap: TEntities;
	readonly entityOrder: readonly (keyof TEntities)[];
	isFinal: boolean;

	finalize(): EntityContainer<TEntity, TEntities>;

	add<T extends TEntity>(
		entity: T,
	): EntityContainer<TEntity, TEntities & { [K in NameOf<TEntity>]: T }>;

	collect<T>(
		block: (entity: TEntity) => Promise<T | null | undefined>,
	): Promise<T[]>;
}

export type EntityMap<TEntity extends AnyEntity> = {
	readonly [TName in string]: TEntity;
};

export function createEntityContainer<TEntity extends AnyEntity>(kind: string): EntityContainer<TEntity, {}> {
	return {
		entityKind: kind,
		entityMap: {},
		entityOrder: [],
		isFinal: false,
		finalize: onFinalize,
		add: onAdd,
		collect: onCollect,
	};
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function onFinalize(
	this: EntityContainer<AnyEntity>,
): EntityContainer<any, any> {
	return {
		...this,
		isFinal: true,
		entityOrder: [ ...this.entityOrder ],
		entityMap: this.entityOrder.reduce<Mutable<EntityMap<AnyEntity>>>((map, key) => {
			map[key] = this.entityMap[key].finalize();
			return map;
		}, {}),
	};
}

function onAdd(
	this: EntityContainer<AnyEntity>,
	entity: AnyEntity,
): EntityContainer<any, any> {
	if (this.entityMap[entity.name] !== undefined) {
		throw new Error(`${this.entityKind} '${entity.name}' has already been added.`);
	}

	if (this.isFinal) {
		(this.entityMap as Mutable<EntityMap<AnyEntity>>)[entity.name] = entity;
		(this.entityOrder as string[]).push(entity.name);
		return this;
	}

	return {
		...this,
		entityMap: {
			...this.entityMap,
			[entity.name]: entity,
		},
		entityOrder: [
			...this.entityOrder,
			entity.name,
		],
	};
}

function onCollect<T>(
	this: EntityContainer<AnyEntity>,
	block: (entity: any) => Promise<T | null | undefined>,
): Promise<T[]> {
	return Promise
		.all(this.entityOrder.map(name => block(this.entityMap[name])))
		.then(result => result.filter(it => it !== null && it !== undefined));
}
